// InputBoard.js (c) 2013-2014 Loren West
// May be freely distributed under the MIT license.
// For further details and documentation:
// http://lorenwest.github.com/beaglebone-monitor
var Monitor = require('monitor'),
    Probe = Monitor.Probe,
    Config = Monitor.Config,
    Bonescript = require('bonescript'),
    bonePins = Bonescript.bone.pins,
    BBUtils = require('../js/BBUtils'),
    IC4067 = require('../js/IC74HC4067'),
    logger = Monitor.getLogger('InputBoard');

/**
* The input board controls a 4051 8 channel mux or a 4067 16 channel mux.
* This board uses 4 GPIO pins to poll for up to 16 inputs.
*
* IO Board      Wire Color        BeagleBone
* ------------|-----------------|-------------------------------------------
* Ground      | Orange Stripe   | Ground
* +3.3v       | Orange          | +3.3v (Vcc or 3v3)
* Input       | Green Stripe    | (specified in initParams.pins)
* +1.8v       | Blue            | +1.8v (Va - Max analog reference voltage)
* Data0       | Blue Stripe     | (specified in initParams.pins)
* Data1       | Green           | (specified in initParams.pins)
* Data2       | Brown Stripe    | (specified in initParams.pins)
* Data3       | Brown           | (specified in initParams.pins)
*
* @class InputBoard
* @constructor
* @param initParams {Object} Probe initialization parameters
* @param [initParams.bbProbeName] {String} probeName of the BB probe
* @param [initParams.pollMs=1000] {Integer} Polling timer interval
* @param initParams.pins {Object} BeagleBone I/O pin IDs (ex: P9_22)
* @param initParams.pins.data0 {String} BB GPIO Pin number for data 0
* @param initParams.pins.data1 {String} BB GPIO Pin number for data 1
* @param [initParams.pins.data2] {String} BB GPIO Pin number for data 2
* @param [initParams.pins.data3] {String} BB GPIO Pin number for data 3
* @param initParams.pins.input {String} Pin number for digital or analog input.
*                   If this is one of the analog input pins then analog values
*                   between 0 and 1 are provided.  Otherwise 0 or 1 are provided.
* @param initParams.inputs {Object Array} Array defining all inputs
* @param initParams.inputs.n.name {String} Name of the probe variable to use
* @param [initParams.inputs.n.description] {String} Human description of the input
* @param [initParams.inputs.n.precision=3] {Number} Number of digits to retain
*                   past the decimal point (rounded). Dry contacts use 0 (for 0/1)
*/
var InputBoard = Probe.extend({

  probeClass: 'InputBoard',

  // Called by Backbone.Model on object construction
  initialize: function(attributes, options){
    var t = this;

    // Assume callback responsibility
    options.asyncInit = true;
    var callback = options.callback;

    // Assign instance data
    t.pins = attributes.pins;
    t.pollMs = (typeof attributes.pollMs === 'undefined') ? 1000 : attributes.pollMs;
    t.inputs = attributes.inputs;
    t.numInputs = t.inputs.length;
    t.ic = null;
    t.isAnalogInput = bonePins[t.pins.input].ain !== 'undefined';
    t.readFn = t.isAnalogInput ? Bonescript.analogRead : Bonescript.digitalRead;
    t.timer = null;  // Timer before next heartbeat
    t.cyanide = false;
    t.currentInput = 0;
    t.heartbeatFn = function(){t.nextHeartbeat();};

    // Build the named data model elements
    t.inputs.forEach(function(input){
      t.set(input.name, 0, {silent:true});
    });

    // Connect a monitor to the beaglebone probe
    var initBBMonitor = function() {
      Bonescript.getPlatform(function(platform) {
        if (!platform.serialNumber) {
          logger.info('initialize', 'No beaglebone detected.  Running in emulation mode.');
        }
        t.emulationMode = platform.serialNumber ? false : true;
        t.set('emulationMode', t.emulationMode);
        t.bbMonitor = null;
        if (attributes.bbProbeName) {
          t.bbMonitor = new Monitor({probeName: attributes.bbProbeName});
          t.bbMonitor.connect(function(error) {
            if (error) {
              logger.error('4067init.bbMonitor', error);
              return callback(error);
            }
            initIC();
          });
        }
        else {
          initIC();
        }
      });
    };

    // Initialize the IC.
    var initIC = function() {
      if (t.emulationMode) {
        return callback();
      }
      t.ic = new IC4067({pins:t.pins}, function(error) {
        if (error) {
          logger.error('4067init.ic', error);
          return callback(error);
        }
        // Perform the first full heartbeat, and callback from initialize
        // once all inputs have been read.
        t.nextHeartbeat(callback);
      });
    };

    // Initialize the input pin unless analog
    if (t.isAnalogInput) {
      initBBMonitor();
    }
    else {
      var modes = [{name: t.pins.input, direction: Bonescript.INPUT}];
      BBUtils.initGPIO(modes, function(error) {
        if (error) {
          logger.error('GPIO Init', error);
          return callback(error);
        }
        initBBMonitor();
      });
    }
  },

  // Shut down the probe
  release: function() {
    var t = this;
    if (t.timer) {
      clearTimeout(t.timer);
      t.timer = null;
    }
    else {
      t.cyanide = true;
    }
  },

  // Heartbeat processing.  One heartbeat reads all inputs.
  // At the end of a heartbeat, it sleeps for the configured
  // interval, and calls the heartbeat again.
  nextHeartbeat: function(callback) {
    var t = this,
        rotateInput = null,
        readInput = null,
        startStamp = Date.now();
    // This is a safety valve, and shouldn't happen
    if (t.currentInput !== 0) {
      logger.error('nextHeartbeat', 'BUG: nextHeartbeat called during an existing heartbeat');
      return;
    }

    // Reset the timer
    if (t.timer) {
      clearTimeout(t.timer);
      t.timer = null;
    }

    // Rotate the input switch to the next position
    rotateInput = function() {

      // Rotate the switch back to zero at the end
      if (++t.currentInput === t.numInputs) {
        t.currentInput = 0;
      }

      // Now switch
      t.ic.switch(t.currentInput, function(err) {

        // We're done with the rotation if we're back around to zero.
        if (t.currentInput === 0) {

          // Set up for the next heartbeat, or stop the heart
          if (!t.cyanide) {
            t.timer = setTimeout(t.heartbeatFn, t.pollMs);
          }

          // We're done with the rotation
          if (callback) {
            callback();
          }
          return;
        }

        // Now read the newly rotated position
        readInput();
      });
    }

    // Read the current input position, and set it into the model if changed.
    readInput = function() {
      t.readFn(t.pins.input, function(x) {
        if (x.err) {
          logger.error('readInput', {msg:'Error reading input', err:x.err});
        }
        else {
          // Set the input value if it's different.  This triggers a change immediately.
          var attrName = t.inputs[t.currentInput].name;
          var precision = t.inputs[t.currentInput].precision;
          precision = typeof precision === 'undefined' ? 3 : precision;
          var attrValue = +x.value.toFixed(precision);
          if (t.get(attrName) !== attrValue) {
            t.set(attrName, attrValue);
            if (t.bbMonitor) {
              t.bbMonitor.set(attrName, attrValue);
            }
          }
        }

        // Get the next value
        rotateInput();
      });
    }

    // Start by reading the current position (which should be 0)
    readInput();
  }

});
