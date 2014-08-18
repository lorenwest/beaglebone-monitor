var b = require('bonescript');
var BBUtils = require('./BBUtils');

/**
 *  This module drives the 74HC595 8-bit shift register.
 *
 *  IC layout:
 *
 *  PIN 15, 1-7 | Out0-7 | Output pins 0-7
 *  PIN 8       | GND    | Ground (-)
 *  PIN 9       | Out7"  | Chain - Serial out (for chaining to data in)
 *  PIN 10      | MR     | Clear - Master Reclear (active low)
 *  PIN 11      | SH_CP  | Clock - Shift Register Clock Pin
 *  PIN 12      | ST_CP  | Latch - Storage Register Clock Pin
 *  PIN 13      | OE     | Enable - Output Enable (low=enable, high=disable)
 *  PIN 14      | SER    | Data - Serial Data
 *  PIN 16      | +VCC   | Supply voltage (+3v3)
 *
 *  Hardware assembly notes:
 *
 *    Always tie MR (master reclear) to +VCC.
 *
 *    Pins are random on power-on, suggest attaching a 10kOhm resistor
 *    from OE (output enable) to +VCC, and using the OE enable pin
 *    if intial state is important.  It can be quite a while between
 *    power-on and this script running.
 *
 *    Suggest using 4 GPIOs: Data, Clock, Latch, and Enable
 *
 *    3 GPIOs if power-on setting isn't important: Data, Clock, Latch
 *    (tie OE to ground)
 *
 *  Software notes:
 *
 *    Initial value passed into init determines number of chips chained
 *    together.  A small int (max 0xFF) drives one chip, otherwise an
 *    array of small ints (max 0xFF) drives multiple chained ICs
 *
 * @class IC74HC595
 * @constructor
 * @param config {object} Configuration
 * @param   config.pins {Object} Pin definitions
 * @param     config.pins.data {String} Data pin name ex: "P9_18"
 * @param     config.pins.clock {String} Clock pin name ex: "P9_22"
 * @param     config.pins.latch {String} Latch pin name ex: "P9_17"
 * @param     [config.pins.enable] {String} Enable (OE) pin name ex: "P9_21"
 * @param     [config.pins.clear] {String} Hardware Clear (MR) pin name ex: "P9_19"
 * @param   config.values {int or [int]} Initial pin values.  A single small int for
 *               driving one chip, an array of int values for multiple chained chips.
 * @param   [config.enabled=true] {boolean} Enable on initialization?
 * @param [callback] {function(error)} Callback to run after initialization
 */
var IC74HC595 = module.exports = function(config, callback) {
  var t = this,
      enable = typeof config.enabled === 'undefined' ? true : config.enabled;
  t.config = config;
  t.pins = config.pins;
  t.values = Array.isArray(config.values) ? config.values : [config.values];
  callback = callback || function(){};

  // Set the pin modes and initial state, then shift out the initial values
  t._setPinModes(function(error) {
    if (error) {
      return callback(error);
    }

    function shiftInitialValues() {
      t.shiftOut(function(error) {
        if (error) {
          return callback(error);
        }
        if (enable) {
          t.enableOutput(callback);
        }
        else {
          callback();
        }
      });
    }

    // Disable if requested, then shift initial values
    if (!enable) {
      t.disableOutput(shiftInitialValues);
    }
    else {
      shiftInitialValues();
    }

  });
};

/**
 * Set the BB pin modes
 *
 * This sets all pins to GPIO OUTPUT
 *
 * @private
 * @method
 * @_setPinModes
 * @param callback {Function(err)}
 */
IC74HC595.prototype._setPinModes = function(callback) {

  // Set the pin modes
  var t = this,
      numPins = 0;

  // Set up the GPIO pins
  var modes = [
    {name: t.pins.data, direction: b.OUTPUT, value: b.LOW},
    {name: t.pins.clock, direction: b.OUTPUT, value: b.LOW},
    {name: t.pins.latch, direction: b.OUTPUT, value: b.LOW}
  ];

  // Don't define the enable pin until enabling.  Otherwise flicker occurs.

  // If clear is defined, set initial value to NOT clear
  if (t.pins.clear) {
    modes.push({name: t.pins.clear, direction: b.OUTPUT, value: b.HIGH});
  }
  BBUtils.initGPIO(modes, callback);

};

/**
 * Sets the value of the specified output pin to b.HIGH or b.LOW
 *
 * You must call shiftOut() after setting to shift the new values out.
 *
 * @method
 * @set
 * @param pin {Number} Pin number (0-n)
 * @return {ENUM} either b.LOW (0) or b.HIGH (1)
 */
IC74HC595.prototype.set = function(pin, value) {
  var t = this;
  var chipNum = Math.floor(pin / 8);
  var chipValue = t.values[chipNum];
  var pin = pin % 8; // pin within the chip
  var mask = Math.pow(2,pin);

  // Set or clear
  if (value) {
    chipValue = chipValue | mask;  // set
  }
  else {
    chipValue = chipValue & ~mask; // clear
  }
  t.values[chipNum] = chipValue;
}

/**
 * Gets the current value of the specified pin
 *
 * @method
 * @get
 * @param pin {Number} Pin number (0-n)
 * @return {ENUM} either b.LOW (0) or b.HIGH (1)
 */
IC74HC595.prototype.get = function(pin) {
  var t = this;
  var chipNum = Math.floor(pin / 8);
  var chipValue = t.values[chipNum];
  var pin = pin % 8; // pin within the chip
  var mask = Math.pow(2,pin);
  return chipValue & mask ? b.HIGH : b.LOW;
}

/**
 * Shift the current values out to the chip(s), starting with the last
 * 595 in the array, and ending with the first 595 in the array.
 *
 * @method
 * @shiftOut
 * @param callback {Function(err)}
 */
IC74HC595.prototype.shiftOut = function(callback) {
  var t = this;
  callback = callback || function(){};

  // Shift out a full 595 chip
  var shift = function(chipNumber) {
    var value = t.values[chipNumber];
    b.shiftOut(t.pins.data, t.pins.clock, b.MSBFIRST, value, function(err) {
      var nextChip = chipNumber - 1;
      if (err) {
        return callback({err:x.err, msg:'Error shifting data out ' + t.pins.data});
      }
      if (nextChip >= 0) {
        return shift(nextChip);
      }

      // Done shifting out.  Latch now.
      t._latch(callback);
    });
  }

  // Shift out the last chip first
  shift(t.values.length - 1);
};

/**
 * Latch the current values into the registers
 *
 * @private
 * @method
 * @_latch
 * @param callback {Function(err)}
 */
IC74HC595.prototype._latch = function(callback) {
  var t = this;

  // Set the latch HIGH, then LOW
  b.digitalWrite(t.pins.latch, b.HIGH, function(err) {
    if (err && err.err) {
      return callback({err: err, msg: 'Error latching HIGH IC74HC595 registers'});
    }
    b.digitalWrite(t.pins.latch, b.LOW, function(err) {
      if (err && err.err) {
        return callback({err: err, msg: 'Error latching LOW IC74HC595 registers'});
      }
      callback();
    });
  });
};

/**
 * Enable the output pins
 *
 * This sets the enable pin low (enabling) if not enabled.
 *
 * @method
 * @enableOutput
 * @param callback {Function(err)}
 */
IC74HC595.prototype.enableOutput = function(callback) {
  var t = this;
  callback = callback || function(){};

  // No-op if if no enable pin defined
  if (!t.pins.enable) {
    return callback();
  }

  // Initialize the GPIO pin if not done before
  if (t.enabled === undefined) {
    BBUtils.initGPIO({name: t.pins.enable, direction: b.OUTPUT, value:b.LOW}, function(err) {
      if (err && err.err) {
        return callback({err: err, msg: 'Error enabling IC74HC595 output'});
      }
      t.enabled = true;
      return callback();
    });
    return;
  }

  // GPIO is initialized.
  b.digitalWrite(t.pins.enable, b.LOW, function(err) {
    if (err && err.err) {
      return callback({err: err, msg: 'Error enabling IC74HC595 output'});
    }
    t.enabled = true;
    return callback();
  });
};

/**
 * Disable the output pins
 *
 * This sets the enable pin high (disabling) if enabled.
 *
 * @method
 * @disableOutput
 * @param callback {Function(err)}
 */
IC74HC595.prototype.disableOutput = function(callback) {
  var t = this;
  callback = callback || function(){};

  // No-op if no enable pin defined
  if (!t.pins.enable) {
    return callback();
  }

  // Initialize the GPIO pin if not done before
  if (t.enabled === undefined) {
    BBUtils.initGPIO({name: t.pins.enable, direction: b.OUTPUT, value:b.HIGH}, function(err) {
      if (err && err.err) {
        return callback({err: err, msg: 'Error disabling IC74HC595 output'});
      }
      t.enabled = false;
      return callback();
    });
    return;
  }

  // GPIO is initialized.
  b.digitalWrite(t.pins.enable, b.HIGH, function(err) {
    if (err && err.err) {
      return callback({err: err, msg: 'Error disabling IC74HC595 output'});
    }
    t.enabled = false;
    return callback();
  });
};

/**
 * Hardware Clear
 *
 * This performs a hardware clear if the clear pin is defined, otherwise
 * it performs a software clear (setting all to zero);
 *
 * @method
 * @clearOutput
 * @param callback {Function(err)}
 */
IC74HC595.prototype.clearOutput = function(callback) {
  var t = this;
  callback = callback || function(){};

  // Software clear if no hardware clear pin defined
  if (!t.pins.clear) {
    for (var i = 0; i < t.values.length; i++) {t.values[i] = 0;}
    return t.shiftOut(callback);
  }

  // Set the clear LOW, then HIGH
  b.digitalWrite(t.pins.clear, b.LOW, function(err) {
    if (err && err.err) {
      return callback({err: err, msg: 'Error clearing LOW IC74HC595'});
    }
    b.digitalWrite(t.pins.clear, b.HIGH, function(err) {
      if (err && err.err) {
        return callback({err: err, msg: 'Error clearing HIGH IC74HC595'});
      }
      return callback();
    });
  });
};
