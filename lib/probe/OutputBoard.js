// OutputBoard.js (c) 2013 Loren West
// May be freely distributed under the MIT license.
// For further details and documentation:
// http://lorenwest.github.com/beaglebone-monitor
var Monitor = require('monitor'),
    Probe = Monitor.Probe,
    Config = Monitor.Config,
    Bonescript = require('bonescript'),
    BBUtils = require('../js/BBUtils'),
    IC595 = require('../js/IC74HC595'),
    logger = Monitor.getLogger('OutputBoard');

/**
* The output board is a series of 595 chips, attached to the main board
* with an ethernet cable.
*
* It can host any number of digital outputs, 8 per 595 chip.
*
* It uses 4 GPIO ports (3 if the initial output isn't important)
*
* IO Board      Wire Color        BeagleBone
* ------------|-----------------|-------------------------------------------
* Ground      | Orange Stripe   | Ground
* +3.3v       | Orange          | +3.3v (Vcc or 3v3)
* +5v         | Green Stripe    | +5v   (Vin)
* data        | Blue            | (specified in initParams.pins)
* clock       | Blue Stripe     | (specified in initParams.pins)
* latch       | Green           | (specified in initParams.pins)
* enable      | Brown Stripe    | (specified in initParams.pins)
* not used    | Brown           | not used
*
* For more information about the board design, see: [TODO]
*
* @class OutputBoard
* @constructor
* @param initParams {Object} Probe initialization parameters
* @param initParams.pins {Object} BeagleBone I/O pin IDs (ex: P9_22)
* @param initParams.pins.data {String} Pin number for ic595 data
* @param initParams.pins.clock {String} Pin number for ic595 clock
* @param initParams.pins.latch {String} Pin number for ic595 latch
* @param [initParams.pins.enable] {String} Pin number for ic595 enable
* @param initParams.outputs {Object Array} Array defining all output positions.
* @param initParams.outputs.n.name {String} Name of the probe variable to use
* @param [initParams.outputs.n.description] {String} Human description of the input
* @param [initParams.outputs.n.inverse=false] {Boolean} Inverse 0/1? Useful for relay module
* @param [initParams.outputs.n.initialValue=0] {Integer} Initial output value (0 or 1)
*/
var OutputBoard = Probe.extend({

  probeClass: 'OutputBoard',

  // Called by Backbone.Model on object construction
  initialize: function(attributes, options){
    var t = this;

    // Assume callback responsibility
    options.asyncInit = true;
    var callback = options.callback;

    // Assign instance data
    t.pins = attributes.pins;
    t.outputs = attributes.outputs;
    t.numOutputs = t.outputs.length;
    t.num595chips = Math.ceil(t.numOutputs / 8);
    t.ic595 = null;
    t.validOutputNames = [];
    t.ic595Array = []; // One element per 595 chip
    t.isDisabled = true;

    // Build the named data model elements
    t.outputs.forEach(function(output){
      t.validOutputNames.push(output.name);
      var value = output.initalValue ? 1 : 0;
      t.set(output.name, value, {silent:true});
    });

    // Initialize the 959 array with zeros
    for (var i = 0; i < t.num595chips; i++) {
      t.ic595Array.push(255);
    }

    // Initialize the 595 library, but keep the chips disabled until
    // the values are set.
    t.ic595 = new IC595({pins: t.pins, values:t.ic595Array, enabled:false}, function(error) {
      if (error) {
        logger.error('595init', error);
        return callback(error);
      }

      // Now output the values (this enables the output)
      t.sendOutputs(callback);
    });
  },

  // Send the current output states to the 595 array
  sendOutputs: function(callback) {
    var t = this;

    // Set each output value
    for (var i = 0; i < t.outputs.length; i++) {
      var value = t.get(t.outputs[i].name);
      if (t.outputs[i].inverse) {
        value = value ? 0 : 1;
      }
      t.ic595.set(i, value);
    }

    // Now shift them out
    t.ic595.shiftOut(function(error){
      if (error) {
        return callback(error);
      }

      // If the 595 is disabled, enable it now
      if (t.isDisabled) {
        t.isDisabled = false;
        return t.ic595.enableOutput(callback);
      }
      callback();
    });
  },

  /**
  * Enable or disable the output board pins
  *
  * @method enable_control
  * @param enabled {boolean} Enabled or disabled (t/f)
  * @param callback {function(err)} Called when done or error
  */
  enable_control: function(params, callback) {
    var t = this;
    callback = callback || function(){};
    if (typeof(params.enabled) === 'undefined' || params.enabled) {
      t.ic595.enableOutput(callback);
    }
    else {
      t.ic595.disableOutput(callback);
    }
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
      if (t.validOutputNames.indexOf(paramName) < 0) {
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

    // Set the output values so they can be sent out (this updates monitors)
    t.set(outputs);

    // Send outputs to the ICs
    t.sendOutputs(callback);
  }

});
