// BeagleBone.js (c) 2013-2014 Loren West
// May be freely distributed under the MIT license.
// For further details and documentation:
// http://lorenwest.github.com/beaglebone-monitor

var Monitor = require('monitor'),
    logger = Monitor.getLogger('BeagleBone'),
    Probe = Monitor.Probe,
    Config = Monitor.Config,
    Bonescript = require('bonescript'),
    bonePins = Bonescript.bone.pins,
    logger = Monitor.getLogger('BeagleBone');

/**
* This is a probe exposure for remote monitoring and control of the beaglebone.
*
* It allows you to define pin names, and interact with the beaglebone by your
* own pin names, and establish polling and real-time monitoring for input pins.
*
* The data model contains an element for each mapped pin (by name), and an
* element called pins, containing a hash of pin name to everything known about
* that pin.
*
* @class BeagleBone
* @constructor
*/
var BeagleBone = Probe.extend({

  probeClass: 'BeagleBone',
  initialize: function(params, options) {
    var t = this;

    // The pin map by name is exposed by the probe
    // key=>Pin name (as set by definePins), value=>Pin object
    t.pinMapByName = {};
    t.pinMapString = '';

    // The pin map by BbPin keys on BeagleBone pin name
    // key=>beaglebone pin name 'P9_22'  value=>Pin object
    t.pinMapByBbPin = {};

    // key=>ms delay, value=>{interval:interval, reads:[array of pin names to read]}
    t.timerMap = {};

    // Load any locally configured pins
    if (params.initialPins) {

      // Take over callback control
      options.asyncInit = true;

      // Configure the pins
      logger.info('init.initialPins', 'Configuring initial pins', params.initialPins);
      t.definePins_control(params.initialPins, options.callback);
    }

    // Set the initial data model
    t.updateModel({});
  },

  // This updates the data model in a single change.
  // @param updates {Object} Map of pin names to values
  updateModel: function(updates) {
    var t = this;

    // Update the whole pin map if necessary
    var pinMapString = JSON.stringify(t.pinMapByName);
    if (t.pinMapString !== pinMapString) {
      t.pinMapString = pinMapString;
      updates.pins = JSON.parse(JSON.stringify(t.pinMapByName));
    }

    // Update the data model
    t.set(updates);
  },

  /**
  * Define the controller pin mappings
  *
  * Pin mappings initialize the beaglebone I/O pins, and map them to your
  * own names.
  *
  * @method definePins_control - Remote pin mapping
  * @param pins {Array of Object} Initial I/O pin definitions
  * @param pins.n.name {String} The logical name to assign the pin
  * @param [pins.n.bbName] {String} The beaglebone name of the pin ('P9_22')
  * @param [pins.n.type='manual'] {String} The pin type enumeration:
  *        gpio: The pin is mapped to a GPIO header
  *        analog: The pin is mapped to an analog input
  *        manual: Externally set by setPinValue_control
  * @param [pins.n.direction] {String} Pin direction ('in' or 'out')
  * @param [pins.n.value] {Mixed} Initial value to set the pin to
  * @param [pins.pull='pullup'] - (GPIO out) One of 'pullup', 'pulldown', or 'disabled'
  * @param [pins.slew='fast'] - (GPIO out) One of 'fast' or 'slow'
  * @param [pins.frequency=2000] - PWM frequency for digital output pins
  * @param [pins.n.precision=3] {Number} Number of digits to retain past the
  *        decimal point (rounded) for analog input pins.
  *        Dry contacts use 0 (for 0/1)
  * @param [pins.n.pollMs=1000] {Number} Number of milliseconds to poll for input values
  * @param callback {function(error)} - Called when done
  */
  definePins_control: function(pins, callback) {
    var t = this,
        pinsToSetMode = [], // full pin definition
        pinsToRead = [],    // pin names
        pinsToWrite = {};   // Map of pin name->value

    // Perform validation before setting the pins
    pins.forEach(function(pin) {

      // Is this pin name already defined?
      if (t.pinMapByName[pin.name]) {
        return callback({code: 'NAME_IN_USE', msg: 'Pin name is already taken: ' + pin.name, pin: pin});
      }

      // Is this mapped to a beaglebone pin?
      if (pin.bbName) {

        // Is this a known pin?
        if (!bonePins[pin.bbName]) {
          return callback({code: 'UNKNOWN_PIN', msg: 'BeagleBone pin name not found: ' + pin.bbName, pin: pin});
        }
        pin.bonePin = bonePins[pin.bbName];

        // Is this pin name already defined?
        if (t.pinMapByBbPin[pin.bbName]) {
          return callback({code: 'PIN_IN_USE', msg: 'Pin is already in use: ' + pin.bbName, pin: pin});
        }
      }

    });

    // Define each pin
    pins.forEach(function(pin) {

      // Add the pin definition to the maps
      t.pinMapByName[pin.name] = pin;
      if (pin.bbName) {
        t.pinMapByBbPin[pin.bbName] = pin;
      }

      // Process a GPIO pin
      if (pin.type === 'gpio') {
        pin.direction = pin.direction || 'in';
        if (!pin.bonePin || !pin.bonePin.gpio) {
          return callback({code:'NOT_GPIO_PIN', msg: 'Not an analog input type pin: ' + pin.name, pin: pin});
        }
        if (pin.direction === 'in') {
          pin.precision = 0;
          pinsToRead.push(pin.name);
        }
        else {
          if (typeof pin.value !== 'undefined') {
            pinsToWrite[pin.name] = pin.value;
          }
        }
        pinsToSetMode.push(pin);
      }

      // Process an analog pin
      else if (pin.type === 'analog') {
        pin.direction = pin.direction || 'in';
        if (pin.direction === 'in') {
          // Analog input pin
          if (!pin.bonePin || !pin.bonePin.ain) {
            return callback({code:'NOT_ANALOG_IN', msg: 'Not an analog input type pin: ' + pin.name, pin: pin});
          }
          if (typeof pin.precision === 'undefined') {
            pin.precision = 3;
          }
          pinsToRead.push(pin.name);
        }
        else {
          // Analog output pin
          if (!pin.bonePin || !pin.bonePin.pwm) {
            return callback({code:'NOT_ANALOG_OUT', msg: 'Not an analog output (PWM) type pin: ' + pin.name, pin: pin});
          }
          if (typeof pin.frequency === 'undefined') {
            pin.frequency = 2000;
          }
          if (typeof pin.value !== 'undefined') {
            pinsToWrite[pin.name] = pin.value;
          }
        }
      }

      // Process a manual pin
      else if (pin.type === 'manual') {
        if (typeof pin.value !== 'undefined') {
          pinsToWrite[pin.name] = pin.value;
        }
      }

    });

    // Set pin modes, write outputs, then read inputs
    t.setPinModes(pinsToSetMode, function(error) {
      if (error) {
        return callback(error);
      }
      t.write_control(pinsToWrite, function(error) {
        if (error) {
          return callback(error);
        }
        t.read_control(pinsToRead, function(error) {
          if (error) {
            return callback(error);
          }
          return callback(null);
        });
      });
    });
  },

  /**
  * Read a bunch of digital or analog pins
  *
  * @method read_control
  * @param pinNames {Array of String} Array of defined pin names to read
  * @param callback {function(error, valueMap)} - A map of pin name to pin values
  */
  read_control: function(pinNames, callback) {
    var t = this,
        didError = false,
        valueMap = {};

    // Convert to an array
    pinNames = Array.isArray(pinNames) ? pinNames : [pinNames];
    var numLeft = pinNames.length;
    if (pinNames.length === 0) {
      return callback(null,{});
    }

    // Validate the input
    pinNames.forEach(function(pinName) {
      var pin = t.pinMapByName[pinName];
      if (!pin) {
        return callback({code:'NO_PIN', msg:'No pin defined with name: ' + pinName});
      }
      if (pin.direction !== 'in') {
        return callback({code:'BAD_PIN', msg:'This isnt an input pin: ' + pinName});
      }
      if (pin.type !== 'analog' && pin.type !== 'digital') {
        return callback({code:'BAD_PIN_type', msg:'This isnt a digital or analog input pin: ' + pinName});
      }
    });

    // Called when done
    var numLeft = pinNames.length;
    var whenDone = function(error) {
      if (didError) {
        return;
      }
      if (error) {
        didError = true;
        t.updateModel(valueMap);
        return callback(error);
      }
      if (--numLeft === 0) {
        t.updateModel(valueMap);
        return callback(null, valueMap);
      }
    }

    // Perform the read on each pin
    pinNames.forEach(function(pinName) {
      var pin = t.pinMapByName[pinName];
      var readFn = pin.type === 'analog' ? 'analogRead' : 'digitalRead';
      Bonescript[readFn](pin.bbName, function(x) {
        var error = x.err;
        var value = x.value;
        if (!error) {
          value = +value.toFixed(pin.precision);
          valueMap[pinName] = value;
        }
        whenDone(error);
      });
    });
  },

  /**
  * Write a bunch of pins, calling the callback when done
  *
  * @method write_control
  * @param pins {Object} Map of pins to write, name=pinName, value=value
  * @param callback {function(error)} - Called when complete
  */
  write_control: function(pins, callback) {
    var t = this,
        didError = false,
        allPins = [],
        valueMap = {};

    if (pins.length === 0) {
      return callback(null);
    }
    // Validate the input
    for (var pinName in pins) {
      var pin = t.pinMapByName[pinName];
      if (!pin) {
        return callback({code:'NO_PIN', msg:'No pin defined with name: ' + pinName});
      }
      if (pin.direction !== 'out') {
        return callback({code:'BAD_PIN', msg:'This isnt an output pin: ' + pinName});
      }
      if (pin.type !== 'analog' && pin.type !== 'gpio') {
        return callback({code:'BAD_PIN_TYPE', msg:'This isnt an analog or gpio pin: ' + pinName});
      }
      allPins.push(pinName);
    }

    // Called when done
    var numLeft = allPins.length;
    var whenDone = function(error) {
      if (didError) {
        return;
      }
      if (error) {
        didError = true;
        t.updateModel(valueMap);
        return callback(error);
      }
      if (--numLeft === 0) {
        t.updateModel(valueMap);
        return callback(null, valueMap);
      }
    }

    // Perform the write on each pin
    allPins.forEach(function(pinName) {
      var pin = t.pinMapByName[pinName];
      var value = pins[pinName];
      if (pin.type === 'analog') {
        Bonescript.analogWrite(pin.bbName, value, pin.frequency, function(x) {
          var error = x.err;
          if (!error) {
            valueMap[pinName] = value;
          }
          whenDone(error);
        });
      }
      else {
        Bonescript.digitalWrite(pin.bbName, value, function(x) {
          var error = x.err;
          if (!error) {
            valueMap[pinName] = value;
          }
          whenDone(error);
        });
      }
    });
  },

  /**
  * Set pin modes for a group of pins
  *
  * @method setPinModes
  * @param pins {Object array} An array of pin modes to set
  * @param pins.n.bbName {String} The beaglebone pin name (P9_22)
  * @param pins.n.direction - One of b.INPUT or b.OUTPUT
  * @param [pins.n.mux=7] - Pin mux number (7 for gpio)
  * @param [pins.n.pull='pullup'] - One of 'pullup', 'pulldown', or 'disabled'
  * @param [pins.slew='fast'] - One of 'fast' or 'slow'
  * @param callback {function(error)} - Callback when complete
  */
  setPinModes: function(pins, callback) {
    var t = this;

    // Make an array, and default callback
    pins = Array.isArray(pins) ? pins : [pins];
    if (pins.length === 0) {
      return callback(null);
    }

    // Function for each pin
    var setPin = function(currentPin, cb) {
      var pin = pins[currentPin],
          mux = typeof pin.mux === 'undefined' ? 7 : pin.mux,
          pull = pin.pull ? pin.pull : 'pullup',
          slew = pin.slew ? pin.slew : 'fast';

      // Set the mode
      Bonescript.pinMode(pin.bbName, pin.direction, mux, pull, slew, function(err) {
        if (err && err.err) {
          return cb({err: err, msg: 'Error setting the pin mode for: ' + pin.bbName});
        }
        return cb(null);
      });
    };

    // Called when done with each pin
    var didError = false;
    var numLeft = pins.length;
    var whenDone = function(error) {
      if (didError) {
        return;
      }
      if (error) {
        didError = true;
        return callback(error);
      }
      if (--numLeft === 0) {
        callback();
      }
    }

    // Set each pin in parallel
    for (var i = 0; i < pins.length; i++) {
      setPin(i, whenDone);
    }
  },

  // Release resources held by the probe
  release: function() {
    var t = this;

    // Shut down all timers
    for (var i in t.timerMap) {
      var timer = t.timerMap[i];
      clearInterval(timer.interval);
    }
    t.timerMap = {};
  }

});
