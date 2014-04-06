beaglebone-monitor
==================

I/O Monitoring for the BeagleBone

FEATURES
========

  * Remote representation and control
  * Microcontroller abstraction (possible?)
  * BeagleBone probe (singleton to run representing the BB)
  * MultiInput board probe (multi-instance - for controlling a MUX)
  * MultiOutput board probe (multi-instance - for controlling a 7401)
  * Examples using auto-start probes, data model probes, recipes

MICROCONTROLLER PROBE (beaglebone, arduino, raspberry pi)
(Abstracts GPIO, SPI, access)

  * BBProbe
    * Singleton (opens a server port to be sure)
    * Reserve/Assign IO pins by client
    * Offer a pin-managed interface to higher level probes
    * Offer direct interface to non-managed pins

Microcontroller app
  * Configures the BB Probe
  * Configures all I/O probes
  * Configures all recipes

