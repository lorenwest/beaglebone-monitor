
var b = require('bonescript');
var BBUtils = require('./BBUtils');

/**
 *  This module drives the 74HC4067 16-channel analog mixer
 *  or the 74HC4051 8 channel equivalent
 *
 *  This IC acts like a rotary switch, switching in/out voltage
 *  from pin 1 (common I/O) through I0-I15.
 *
 *  Data Sheet: http://bit.ly/1ayDaoB
 *  Tutorial:   http://bit.ly/13zjBdf
 *
 *  IC layout:
 *
 *  PIN 1       | Common I/O
 *  PIN 12      | Ground
 *  PIN 24      | Driver VCC (2-6vdc)
 *  PIN 15      | Enable Flow (VCC=Disable, GND=Enable)
 *  PIN 10,11,14,13 | Data Switch 0-3 (respectively)
 *  PIN 9-2     | I/O 0-7  (respectively)
 *  PIN 23-16   | I/O 8-15 (respectively)
 *
 *  Hardware assembly notes:
 *
 *    Tie 15 (Enable) to ground for flow, VCC to stop flow to current switch
 *
 *    See the data switch for switch voltage and amperage ratings
 *
 * @class IC74HC4067
 * @constructor
 * @param config {Object} IC Configuration
 * @param   config.pins {Object} Pin definitions
 * @param     config.pins.data0 {String} BB data0 pin name ex: "P9_18"
 * @param     config.pins.data1 {String} BB data1 pin name ex: "P9_19"
 * @param     config.[pins.data2=''] {String} BB data2 pin name ex: "P9_20"
 * @param     config.[pins.data3=''] {String} BB data3 pin name ex: "P9_21"
 * @param     config.[pins.enable] {String} Enable pin name ex: "P9_22"
 * @param   [enabled=true] {Boolean} Initial enabled true/false
 * @param   [position=0] {int} Current switch position (0-15)
 * @param [callback] {function(error)} Callback to run after initialization
 */
var IC74HC4067 = module.exports = function(config, callback) {
  var t = this;
  t.pins = {};
  t.pins.data0 = config.pins.data0;
  t.pins.data1 = config.pins.data1;
  t.pins.data2 = config.pins.data2 || '';
  t.pins.data3 = config.pins.data3 || '';
  t.pins.enable = config.pins.enable || '';
  t.enabled = config.enabled;
  t.position = config.position || 0;
  callback = callback || function(){};

  // Set the pin I/O modes
  t._setPinModes(function(error) {
    if (error) {
      return callback(error);
    }

    // Set initial enable/disable
    t.enable(t.enabled, function(error) {
      if (error) {
        return callback(error);
      }

      // Set initial switch position
      t.switch(t.position, function(error) {
        if (error) {
          return callback(error);
        }
        callback();
      });
    });
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
IC74HC4067.prototype._setPinModes = function(callback) {

  // Set the pin modes
  var t = this;

  // Set up the GPIO pins
  var modes = [
    {name: t.pins.data0, direction: b.OUTPUT, value: b.LOW},
    {name: t.pins.data1, direction: b.OUTPUT, value: b.LOW}
  ];

  // Set the optional pins
  if (t.pins.data2) {
    modes.push({name: t.pins.data2, direction: b.OUTPUT, value: b.LOW});
  }
  if (t.pins.data3) {
    modes.push({name: t.pins.data3, direction: b.OUTPUT, value: b.LOW});
  }
  if (t.pins.enable) {
    modes.push({name: t.pins.enable, direction: b.OUTPUT, value: b.LOW});
  }

  // Initialize the BB pins
  BBUtils.initGPIO(modes, callback);

};

/**
 * Enable (or disable) flow to the common I/O pin
 *
 * @method
 * @enable
 * @param [enabled=true] {Boolean} Enable the flow?
 * @param [callback] {Function(err)}
 */
IC74HC4067.prototype.enable = function(enabled, callback) {
  var t = this;

  // Process optional params
  if (typeof(enabled) === 'function') {
    callback = enabled;
  }
  callback = callback || function(){};

  // Default enabled to true;
  if (typeof(enabled) !== 'boolean') {
    enabled = true;
  }

  // Don't process if the enabled pin isn't configured
  if (!t.pins.enable) {
    return callback();
  }

  // Tie pin 15 (enable) LOW to enable, HIGH to disable
  var pinValue = enabled ? b.LOW : b.HIGH;
  b.digitalWrite(t.pins.enable, pinValue, function(err) {
    if (err && err.err) {
      return callback({err: err.err, msg: 'Error enabling IC74HC4067'});
    }
    t.enabled = enabled;
    callback();
  });
};

/**
 * Switch the I/O to the specified I/O number
 *
 * @method
 * @switch
 * @param position {Int} Pin number to switch to (0-15)
 * @param callback {Function(err)}
 */
IC74HC4067.prototype.switch = function(position, callback) {
  var t = this;
  callback = callback || function(){};

  // Precondition - value must be in the range
  if (position < 0 ||
      (!t.pins.data2 && position > 3) ||
      (!t.pins.data3 && position > 7) ||
      (position > 15)) {
    return callback({err: 'RANGE', msg: 'Value out of range for IC74HC4067: ' + position});
  }

  // Called when a pin is set
  var numPinsLeft = 0;
  var didError = false;
  var whenSet = function(err) {

    // Process error (no-op if already errored)
    if (didError) {return;}
    if (err && err.err) {
      didError = true;
      return callback(err.err);
    }

    // Callback if this is the last pin
    if (--numPinsLeft === 0) {
      t.position = position;
      return callback();
    }

    // Still processing pins
    return;
  };

  // Set b.HIGH or b.LOW based on truthy
  function highOrLow(value) {
    return value ? b.HIGH : b.LOW;
  }

  // Set pins asynchronously in parallel
  numPinsLeft++;
  b.digitalWrite(t.pins.data0, highOrLow(position & 0x1), whenSet);
  numPinsLeft++;
  b.digitalWrite(t.pins.data1, highOrLow(position & 0x2), whenSet);
  if (t.pins.data2) {
    numPinsLeft++;
    b.digitalWrite(t.pins.data2, highOrLow(position & 0x4), whenSet);
    if (t.pins.data3) {
      numPinsLeft++;
      b.digitalWrite(t.pins.data3, highOrLow(position & 0x8), whenSet);
    }
  }
};
