var b = require('bonescript');

/**
 * General purpose beaglebone utilities
 *
 *
 * Serial UART info:
 *
 *  UART0: only used for serial debugging, going through the USB port next to
 *         the power supply plug - can't be used by your programs
 *  UART3: pins are not available on the expansion headers can't be easily
 *         used by your programs
 *  UART5: only has RX and TX pins (no CTS and RTS pins available)
 *
 *  UART         RX             TX              CTS             RTS
 *  UART1  P9_26, Mode: 0  P9_24, Mode: 0  P9_20, Mode: 0  P9_19, Mode: 0
 *  UART2  P9_22, Mode: 1  P9_21, Mode: 1  P8_37, Mode: 6  P8_38, Mode: 6
 *  UART4  P9_11, Mode: 6  P9_13, Mode: 6  P8_35, Mode: 6  P8_33, Mode: 6
 *  UART5  P8_38, Mode: 4  P8_37, Mode: 4  -  -
 */

var BBUtil = module.exports = {}; // Hash of static functions.  Not a class

/**
 * Initialize up a group of GPIO pins
 *
 * This sets the pin modes and default values for the specified GPIO pins
 *
 * @static
 * @method
 * @initGPIO
 * @param pins {[Object]} - An array of (or one) GPIO pin definitions
 *     @param pins.name - Name of the pin
 *     @param pins.direction - One of b.INPUT or b.OUTPUT
 *     @param [pins.value] - Initial value (for b.OUTPUT).  One of b.HIGH or b.LOW
 *     @param [pins.pull='pullup'] - One of 'pullup', 'pulldown', or 'disabled'
 *     @param [pins.slew='fast'] - One of 'fast' or 'slow'
 * @param callback {function(error)} - Callback when complete
 */
BBUtil.initGPIO = function(pins, callback) {

  // Make an array, and default callback
  pins = Array.isArray(pins) ? pins : [pins];
  callback = callback || function(){};

  // Set up each pin sequentially
  var setPin = function(currentPin) {
    var pin = pins[currentPin],
        pull = pin.pull ? pin.pull : 'pullup',
        slew = pin.slew ? pin.slew : 'fast';

    // Set the mode
    b.pinMode(pin.name, pin.direction, 7, pull, slew, function(err) {
      var nextPin = currentPin + 1;
      if (err && err.err) {
        return callback({err: err, msg: 'Error setting the pin mode for: ' + pin.name});
      }

      // Set the initial value?
      if (pin.direction === b.OUTPUT && pin.value) {
        b.digitalWrite(pin.name, pin.value, function(err) {
          if (err & err.err) {
            return callback({
              err: err,
              msg: 'Error setting initial value for: ' + pin.name});
          }

          // Process the next pin, or callback if done
          if (nextPin < pins.length) {
            setPin(nextPin);
          } else {
            callback();
          }
        });
        return;
      }

      // Not an output pin.  Process next pin, or callback.
      if (nextPin < pins.length) {
        setPin(nextPin);
      } else {
        callback();
      }
    });
  };

  // Invoke for the first pin
  setPin(0);
};
