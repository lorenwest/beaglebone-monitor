// IOBoard.js (c) 2013-2014 Loren West
// May be freely distributed under the MIT license.
// For further details and documentation:
// http://lorenwest.github.com/beaglebone-monitor
var Monitor = require('monitor'),
    Probe = Monitor.Probe,
    Config = Monitor.Config,
    Bonescript = require('bonescript'),
    BBUtils = require('../js/BBUtils'),
    IC595 = require('../js/IC74HC595'),
    logger = Monitor.getLogger('IOBoard');

// Constants
ANALOG_INPUT_PINS = ['P9_33','P9_35','P9_36','P9_37','P9_38','P9_39','P9_40'];

/**
* The I/O board is a tradeoff of speed for a single cable.  Use it when:
*
* 1) You need both inputs and outputs
* 2) You want only 1 ethernet cable vs 1 for input, 1 for output
* 3) You don't mind waiting 1 second to scan 16 inputs
*
* The remote IO board is a custom board designed to provide up to
* 16 digital and/or analog inputs, and any number of digital outputs.
*
* It's a combination of an InputBoard and and OutputBoard, where the first
* chip of output controls the input.
*
* IO Board      Wire Color        BeagleBone
* ------------|-----------------|-------------------------------------------
* Ground      | Orange Stripe   | Ground
* +3.3v       | Orange          | +3.3v (Vcc or 3v3)
* +5v         | Green Stripe    | +5v   (Vin)
* +1.8v       | Blue            | +1.8v (Va - Max analog reference voltage)
* ic595 data  | Blue Stripe     | (specified in initParams.pins)
* ic595 clock | Green           | (specified in initParams.pins)
* ic595 latch | Brown Stripe    | (specified in initParams.pins)
* D/A Input   | Brown           | (specified in initParams.pins)
*
* For more information about the board design, see: [TODO]
*
* @class IOBoard
* @constructor
* @param initParams {Object} Probe initialization parameters
* @param [initParams.sleepMs=100] {Integer} Milliseconds to sleep after polling
*                   all inputs.
* @param initParams.pins {Object} BeagleBone I/O pin IDs (ex: P9_22)
* @param initParams.pins.data {String} Pin number for ic595 data
* @param initParams.pins.clock {String} Pin number for ic595 clock
* @param initParams.pins.latch {String} Pin number for ic595 latch
* @param initParams.pins.input {String} Pin number for digital or analog input.
*                   If this is one of the analog input pins then analog values
*                   between 0 and 1 are provided.  Otherwise 0 or 1 are provided.
* @param initParams.inputs {Object Array} Array defining all input positions.
* @param initParams.inputs.n.name {String} Name of the probe variable to use
* @param [initParams.inputs.n.description] {String} Human description of the input
* @param initParams.outputs {Object Array} Array defining all output positions.
* @param initParams.outputs.n.name {String} Name of the probe variable to use
* @param [initParams.outputs.n.description] {String} Human description of the input
* @param [initParams.outputs.n.initialValue=0] {Integer} Initial output value (0 or 1)
*/
var IOBoard = Probe.extend({

  probeClass: 'IOBoard',

  // Called by Backbone.Model on object construction
  initialize: function(options){
    var t = this;

    // Assume callback responsibility
    options.asyncInit = true;
    var callback = options.callback;

    // Assign instance data
    t.pins = options.pins;
    t.sleepMs = (typeof options.sleepMs === 'undefined') ? 100 : options.sleepMs;
    t.inputs = options.inputs;
    t.numInputs = t.inputs.length;
    t.outputs = options.outputs;
    t.numOutputs = t.outputs.length;
    t.num595chips = 1 + Math.ceil(t.numOutputs / 8);
    t.ic595 = null;
    t.isAnalogInput = ANALOG_INPUT_PINS.indexOf(t.pins.input) >= 0;
    t.readFn = t.isAnalogInput ? Bonescript.analogRead : Bonescript.digitalRead;
    t.timer = null;  // Timer before next heartbeat
    t.cyanide = false;
    t.validOutputNames = [];
    t.ic595Array = []; // One element per 595 chip
    t.first595 = [0];  // First 595 chip (controller)
    t.currentInput = 0;
    t.currentOutputLatch = 0;
    t.outputQueued = false;
    t.heartbeatFn = function(){t.nextHeartbeat();};

    // Build the named data model elements
    t.inputs.forEach(function(input){
      t.set(input.name, 0, {silent:true});
    });
    t.outputs.forEach(function(output){
      t.validOutputNames.push(output.name);
      t.set(output.name, output.initialValue ? 1 : 0, {silent:true});
    });

    // Initialize the 959 array with zeros
    for (var i = 0; i < t.num595chips; i++) {
      t.ic595Array.push(0);
    }

    // Initialize the input pin
    var modes = [{name: t.pins.input, direction: Bonescript.INPUT}];
    BBUtils.initGPIO(modes, function(error) {
      if (error) {
        logger.error('GPIO Init', error);
        return callback(error);
      }

      // Initialize the 595 ICs.  One of the zeros is for the
      // enable line in the secondary 959s, keeping all outputs disabled.
console.log('initializing 595', t.ic595Array);
      t.ic595 = new IC595({pins:t.pins, values:t.ic595Array}, function(error) {
console.log('595 initialized');
        if (error) {
          logger.error('595init', error);
          return callback(error);
        }

        // Queue the current outputs to be sent
        t.queueOutputs();
console.log('Outputs queued');

        // Perform the first full heartbeat, and callback from initialize
        // once all inputs have been read.
        t.nextHeartbeat(callback);
      });
    });
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

  // This changes the output pin states, and sets up for sending those
  // out during the next heartbeat interval.
  queueOutputs: function() {
    var t = this;

    // Delay queueing outputs until the current batch is set and latched.
    if (t.currentOutputLatch === 1) {
      setTimeout(function(){
        t.queueOutputs();
      }, 10);
    }

    // Set the 595 values to the full array including outputs
    var current595Values = t.ic595.values;
    t.ic595.values = t.ic595Array;

    // Set each output value into the array
    for (var i = 0; i < t.outputs.length; i++) {
      var value = t.get(t.outputs[i].name);
      t.ic595.set(i + 8, value);
    }

    // Reset the 595 values
    t.ic595.values = current595Values;

    // Queue outputs for sending on the next rotation
    t.outputQueued = true;
  },

  // Heartbeat processing.  One heartbeat reads each input, and sends output
  // if queued.  At the end of a heartbeat, it sleeps for the configured
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

      // Output to all 595s or just the first one
      if (t.outputQueued) {
        t.ic595.values = t.ic595Array;
      } else {
        t.ic595.values = t.first595;
      }

      // Set up the first 595 - controller
      // 0: InputData0
      // 1: InputData1
      // 2: InputData2
      // 3: InputData3
      // 4: not used
      // 5: not used
      // 6: OutputEnable - (always on after first output)
      // 7: OutputLatch  - High on output now, low on next cycle
      t.ic595.values[0] = t.currentInput;  // This sets 0-3 to the input switch location
      t.ic595.set(6, 1);
      t.currentOutputLatch = t.outputQueued ? 1 : 0;
      t.ic595.set(7, t.currentOutputLatch);

      // Reset the output queue
      if (t.outputQueued) {
        logger.info('rotateInput', 'Sending outputs along with input rotation');
        t.outputQueued = false;
      }

      // Now shift everything out
      t.ic595.shiftOut(function(err) {

        // We're done with the rotation if we're back around to zero and we
        // don't have to do another round to reset the output latch.
        if (t.currentInput === 0 && t.currentOutputLatch === 0) {
          logger.info('heartbeat', 'complete in ' + (Date.now() - startStamp) + ' ms.');

          // Set up for the next heartbeat, or stop the heart
          if (!t.cyanide) {
            t.timer = setTimeout(t.heartbeatFn, t.sleepMs);
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
    // The set up for the next input.
    readInput = function() {
      t.readFn(t.pins.input, function(x) {
        if (x.err) {
          logger.error('readInput', {msg:'Error reading input', err:x.err});
        }
        else {
          // Set the input value if it's different.  This triggers a change immediately.
          var attrName = t.inputs[t.currentInput].name;
          if (t.get(attrName) !== x.value) {
            t.set(attrName, x.value);
          }
        }

        // Get the next value
        rotateInput();
      });
    }

    // Start by reading the current position (which should be 0)
    readInput();
  },

  /**
  * Allow outputs to be set by monitors
  *
  * @method setOutputs_control
  * @param outputs {Object} Name/value outputs to set into the probe.  Only names
  *                         defined as outputs can be set by this control, and
  *                         only 0 or 1 are valid values.
  * @param callback {function(err)} Called when done or error
  */
  setOutputs_control: function(outputs, callback) {
    var t = this;
    callback = callback || function(){};

    // Validate the param names and values
    var value = null;
    for (var paramName in outputs) {
      if (t.validOutputsNames.indexOf(paramName) < 0) {
        var err = {msg: 'Invalid output param: "' + paramName + '"'};
        logger.error('setOutputs', err);
        return callback(err);
      }
      value = outputs[paramName];
      if (value !== 0 && value !== 1) {
        var err = {msg: 'Invalid output value (must be 0 or 1)', value: value};
        logger.error('setOutputs', err);
        return callback(err);
      }
    }

    // Now set the output values (this updates monitors)
    t.set(outputs);

    // Queue the outputs for the next heartbeat
    t.queueOutputs();

    // Perform next heartbeat now if we're in waiting
    if (t.timer) {
      t.nextHeartbeat();
    }

    // Success
    return callback();
  }

});
