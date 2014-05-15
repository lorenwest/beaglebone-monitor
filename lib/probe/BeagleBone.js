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
* Probe exposure of a BeagleBone, for remote monitoring & control
*
* This is designed to be run as a singleton on the beaglebone.  It offers a
* single point of interaction with the microcontroller.
*
* It allows you to define pin names, and interact with the beaglebone using your
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
  writableAttributes: '*',

  /**
  * Initialize the probe with known pin mappings
  *
  * You can define pins as probe initialization parameters, or if the probe
  * is already running, you can add pin definitions using the 'definePins'
  * probe control.
  *
  * @constructor
  *
  * @param pins {Array of Object} Initial I/O pin definitions
  *     @param pins.n.id {String} The beaglebone name of the pin ('P9_22')
  *     @param [pins.n.name] {String} The logical name to assign the pin
  *     @param [pins.n.direction='in'] {String} Pin direction ('in' or 'out')
  *     @param [pins.n.value] {Mixed} Initial value to set the pin to
  *     @param [pins.mux=7] - (GPIO out) One of 'pullup', 'pulldown', or 'disabled'
  *     @param [pins.pull='pullup'] - (GPIO out) One of 'pullup', 'pulldown', or 'disabled'
  *     @param [pins.slew='fast'] - (GPIO out) One of 'fast' or 'slow'
  *     @param [pins.frequency=2000] - PWM frequency for digital output pins
  *     @param [pins.n.precision=3] {Number} Number of digits to retain past the
  *            decimal point (rounded) for analog input pins.
  *            Dry contacts use 0 (for 0/1)
  *     @param [pins.n.pollMs=1000] {Number} Number of milliseconds to poll for input values
  */
  initialize: function(params, options) {
    var t = this,
        pins = t.get('pins');

    // Take over callback control
    options.asyncInit = true;

    // Determine if we're running on a beaglebone or in emulation mode
    Bonescript.getPlatform(function(platform) {
      if (!platform.serialNumber) {
        logger.info('initialize', 'No beaglebone detected.  Running in emulation mode.');
        t.set('emulationMode', true);
      }

      // The pin map by ID keys on BeagleBone pin name
      // key=>beaglebone pin name 'P9_22'  value=>Pin object
      t.pinMapById = {};

      // The pin map by name keys on the defined name for the pin
      // and is exposed as 'pins' in the data model.
      // key=>Pin name (as set by definePins), value=>Pin object
      t.pinMapByName = {};
      t.pinMapString = '';

      // key=>ms delay, value=>{interval:interval, readPins:[array of pins to read]}
      t.timerMap = {};

      // Configure the pins
      logger.info('init.pins', 'Configuring initial pins', pins);
      t.definePins_control(pins, options.callback);
    });
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
  * Define controller pin mappings
  *
  * Pin mappings initialize the beaglebone I/O pins and map them to your
  * own names.
  *
  * @method definePins_control - Remote pin mapping
  * @param pins {Array of Object} Initial I/O pin definitions
  *     @param pins.n.id {String} The beaglebone name of the pin ('P9_22')
  *     @param [pins.n.name] {String} The logical name to assign the pin
  *     @param [pins.n.direction='in'] {String} Pin direction ('in' or 'out')
  *     @param [pins.n.value] {Mixed} Initial value to set the pin to
  *     @param [pins.mux=7] - (GPIO out) One of 'pullup', 'pulldown', or 'disabled'
  *     @param [pins.pull='pullup'] - (GPIO out) One of 'pullup', 'pulldown', or 'disabled'
  *     @param [pins.slew='fast'] - (GPIO out) One of 'fast' or 'slow'
  *     @param [pins.frequency=2000] - PWM frequency for digital output pins
  *     @param [pins.n.precision=3] {Number} Number of digits to retain past the
  *            decimal point (rounded) for analog input pins.
  *            Dry contacts use 0 (for 0/1)
  *     @param [pins.n.pollMs=1000] {Number} Number of milliseconds to poll for input values
  * @param callback {function(error)} - Called when done
  */
  definePins_control: function(pins, callback) {
    var t = this,
        pinsToSetMode = [], // full pin definition
        pinsToRead = [],    // pin names
        pinsToWrite = {};   // Map of pin name->value

    // Nothing to do
    if (!pins.length) {
      callback(null);
    }

    // Perform validation before setting the pins
    pins.forEach(function(pin) {

      // Is this a known pin?
      if (!bonePins[pin.id]) {
        return callback({code: 'UNKNOWN_PIN', msg: 'BeagleBone pin name not found: ' + pin.id, pin: pin});
      }
      pin.bonePin = bonePins[pin.id];

    });

    // Define each pin
    pins.forEach(function(pin) {

      // Default pin values
      pin.name = pin.name || pin.id;
      pin.direction = pin.direction || 'in';
      if (pin.bonePin.mux) {
        pin.mux = pin.mux === 'undefined' ? 7 : pin.mux;
      }

      // Add the pin definition to the maps
      t.pinMapById[pin.id] = pin;
      t.pinMapByName[pin.name] = pin;

      // Process a GPIO pin
      if (pin.bonePin.gpio) {
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

      // Process an analog input pin
      else if (typeof pin.bonePin.ain !== 'undefined') {
        if (pin.direction !== 'in') {
          return callback({code:'PIN_ERROR', msg: 'Cannot do PWM on an analog input pin: ' + pin.name, pin: pin});
        }
        if (typeof pin.precision === 'undefined') {
          pin.precision = 3;
        }
        pinsToRead.push(pin.name);
      }

    });

    // Setup the polling timers
    var setTimers = function() {
      pins.forEach(function(pin) {
        var pollMs = pin.pollMs;
        if (pollMs >= 0 && pin.direction === 'in') {

          // Define the timerMap for this polling interval
          // TimerMap: key=>ms delay, value=>{interval:interval, readPins:[array of pins to read]}
          if (!t.timerMap[pollMs]) {
            t.timerMap[pollMs] = {
              interval: null,
              readPins:[]
            }
            t.timerMap[pollMs].interval = setInterval(function() {
              t.read_control(t.timerMap[pollMs].readPins, function(error) {
                if (error) {
                  logger.error('pollMs', error);
                }
              });
            }, pollMs);
          }

          // Add this pin to the timer map
          t.timerMap[pollMs].readPins.push(pin.name);
        }
      });
    }

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
          setTimers();
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
      if (!pin.bonePin.gpio && typeof pin.bonePin.ain === 'undefined') {
        return callback({code:'BAD_PIN_TYPE', msg:'This isnt a digital or analog input pin: ' + pinName});
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
      var pin = t.pinMapByName[pinName],
          readFn = typeof pin.bonePin.ain === 'undefined' ? 'digitalRead' : 'analogRead';
      if (t.get('emulationMode')) {
        logger.trace('read_control', 'Emulating ' + readFn + '(' + pin.id + ') for ' + pin.name);
        return whenDone();
      }
      else {
        Bonescript[readFn](pin.id, function(x) {
          var error = x.err;
          var value = x.value;
          if (!error) {
            value = +value.toFixed(pin.precision);
            valueMap[pinName] = value;
          }
          whenDone(error);
        });
      }
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
        allPins = [];

    // Validate the input
    for (var pinName in pins) {
      var pin = t.pinMapByName[pinName];
      if (!pin) {
        continue;
      }
      if (pin.direction !== 'out') {
        return callback({code:'BAD_PIN', msg:'This isnt an output pin: ' + pinName});
      }
      allPins.push(pinName);
    }
    if (!allPins.length) {
      t.updateModel(pins);
      return callback(null);
    }

    // Called when done
    var numLeft = allPins.length;
    var whenDone = function(error) {
      if (didError) {
        return;
      }
      if (error) {
        didError = true;
        return callback(error);
      }
      if (--numLeft === 0) {
        t.updateModel(pins);
        return callback(null);
      }
    }

    // Perform the write on each pin
    allPins.forEach(function(pinName) {
      var pin = t.pinMapByName[pinName],
          value = pins[pinName];

      // Is this an analog (pwm) write?
      if (pin.bonePin.pwm && pin.bonePin.pwm.muxmode === pin.mux) {

        if (t.get('emulationMode')) {
          logger.trace('write_control', 'Emulating analogWrite(' + pin.id + ',' + value + ') for ' + pin.name);
          return whenDone();
        }
        else {
          Bonescript.analogWrite(pin.id, value, pin.frequency, function(x) {
            var error = x.err;
            whenDone(error);
          });
        }
      }

      // Digital write
      else {
        if (t.get('emulationMode')) {
          logger.trace('write_control', 'Emulating digitalWrite(' + pin.id + ',' + value + ') for ' + pin.name);
          return whenDone();
        }
        else {
          Bonescript.digitalWrite(pin.id, value, function(x) {
            var error = x.err;
            whenDone(error);
          });
        }
      }
    });
  },

  /**
  * Remotely set a probe attribute.
  *
  * This overrides Probe.set_control for settable monitor attributes.  It allows
  * setting pin values by using the remote model.set() method.
  *
  * @method set_control
  * @param attrs {Object} Name/Value attributes to set.  All must be writable.
  * @param callback {Function(error)} Called when the attributes are set or error
  */
  set_control: function(attrs, callback) {
    var t = this;
    t.write_control(attrs, callback);
  },

  /**
  * Set pin modes for a group of pins
  *
  * @method setPinModes
  * @param pins {Object array} An array of pin modes to set
  * @param pins.n.id {String} The beaglebone pin name (P9_22)
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

    // Make an array, and default callback
    // Function for each pin
    var setPin = function(currentPin, cb) {
      var pin = pins[currentPin],
          mux = typeof pin.mux === 'undefined' ? 7 : pin.mux,
          pull = pin.pull ? pin.pull : 'pullup',
          slew = pin.slew ? pin.slew : 'fast';

      // Set the mode
      if (t.get('emulationMode')) {
        logger.trace('setPinModes', 'Emulating pinMode(' + pin.id +',' + mux + ') for ' + pin.name);
        return whenDone();
      }
      else {
        Bonescript.pinMode(pin.id, pin.direction, mux, pull, slew, function(err) {
          if (err && err.err) {
            return cb({err: err, msg: 'Error setting the pin mode for: ' + pin.id});
          }
          return cb(null);
        });
      }
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
