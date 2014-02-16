beaglebone-monitor
==================

I/O Monitoring for the BeagleBone

Come up with a migration path:  What to do NOW to get it running, where I want it to be, and how to get there.

MICROCONTROLLER PROBE (beaglebone, arduino, raspberry pi)
(Abstracts GPIO, SPI, access)

  * BBProbe
    * Singleton (opens a server port to be sure)
    * Register Probe clients (by name)
    * Reserve/Assign IO pins by client
    * Offer a pin-managed interface to higher level probes
    * Offer direct interface to non-managed pins

DEVICE Probes: (Abstracts devices beyond the board)

  * Multi-Input Board - InputBoard.js
    * Registers with singleton BBProbe.js

  * Multi-Output Board - OutputBoard.js
    * Registers with singleton BBProbe.js

RULES Probe:

  * Maintains attribute state
    * Attribute definition
      name, description, datatype, source (can be a monitor attribute or rule)
    * Rule definition
      * Source attributes
      * Destination attributes or monitor/control


SCENARIO Probes:

  * BoilerRoom.js
    * Contains all probe definitions
    * Contains all channel definitions
    * Initializes the BBProbe (resetting the board)
    * Initializes the other probes
    * Starts up each channel

APPLICATION Probes:


Control: Based on abstract concepts vs. pins, voltage levels, blah
GOAL: Build monitors that abstract away the details

if (mon.get('waterFlowValve') === 'DomesticHotWater') {
  mon.set('waterFlowValve', 'RadiantWater');
}

IFTTT Terminology:

Channel       |  App Probe
Recipe        |  Probe instance

Scenarios (High leve probes)
  "Keep the house warm"
  "Don't warm the house too much"
  "Check that it's acting properly"

Trigger       |  Probe Event
Action        |  Probe Control

Channels: Probes?
  Triggers: When something happens (attribute > value)
    Trigger fields
    * Fields defined when defining the trigger
    * Value ranges defined when defining the trigger
    * Values set when the trigger fires
  Actions: Controls
    Action Fields (set when building a recipe)
    * Names set when defining the control
    * Values set (usually hardcoded) when building a recipe
    * Action values can be set from trigger

Recipes:  Tying it all together. = JavaScript main

  * Include everything
  * Define and connect with the probes
  * Initialization sequence (one time)
  * Startup each scenario
    * Monitor scenarios (complex recipes - in their own .js file)


  if (some trigger) then (some action)
  if (some trigger) then (some action)
  ...
