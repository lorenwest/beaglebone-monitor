// This is run when the app is loaded from monitor-dashboard
(function(root){

  // Create a server, and expose this directory
  var Monitor = global.Monitor,
      Connect = require('connect'),
      FS = require('fs'),
      Path = require('path'),
      Static = Connect['static'](__dirname);

  // Load all probes found in the ./probe directory
  // This is synchronous because require() is synchronous
  FS.readdirSync(Path.join(__dirname, 'probe')).forEach(function(fileName) {
    if (fileName.substr(-3) === '.js') {
      require('./probe/' + fileName);
    }
  });

  // Export a middleware component
  var app = module.exports = function(request, response, next) {

    // Process dynamic app endpoints here
    if (request.url === '/status') {
      response.writeHead(200, {'Content-Type': 'text/plan'});
      return response.end('ok');
    }

    // Forward to the static endpoint, then to the next step
    // if the file isn't there.  The next step is a monitor page.
    return Static(request, response, next);
  }

  // Testing - create a test IO board
  /*
  global.testBoard = new Monitor({probeClass:'IOBoard', initParams:{
    sleepMs: 1000,
    pins: {
      data: 'P9_11',
      clock: 'P9_12',
      latch: 'P9_13',
      input: 'P9_14'
    },
    inputs: [
      {name: 'i0'},
      {name: 'i1'},
      {name: 'i2'},
      {name: 'i3'},
      {name: 'i4'},
      {name: 'i5'},
      {name: 'i6'},
      {name: 'i7'},
      {name: 'i8'},
      {name: 'i9'},
      {name: 'i10'},
      {name: 'i11'},
      {name: 'i12'},
      {name: 'i13'},
      {name: 'i14'},
      {name: 'i15'}
    ],
    outputs: [
      {name: 'o0'},
      {name: 'o1', initialValue: 1},
      {name: 'o2'},
      {name: 'o3', initialValue: 1},
      {name: 'o4'},
      {name: 'o5', initialValue: 1},
      {name: 'o6'},
      {name: 'o7', initialValue: 1},
      {name: 'o8'},
      {name: 'o9', initialValue: 1},
      {name: 'o10'},
      {name: 'o11', initialValue: 1},
      {name: 'o12'},
      {name: 'o13', initialValue: 1},
      {name: 'o14'},
      {name: 'o15', initialValue: 1}
    ]
  }});
  global.testBoard.connect();
  */

  /*
  // Testing - create a test IO board
  global.testBoard = new Monitor({probeClass:'InputBoard', initParams:{
    sleepMs: 20,
    pins: {
      data0: 'P9_11',
      data1: 'P9_12',
      data2: 'P9_13',
      data3: 'P9_17',
      input: 'P9_16'
    },
    inputs: [
      {name: 'i0'},
      {name: 'i1'},
      {name: 'i2'},
      {name: 'i3'},
      {name: 'i4'},
      {name: 'i5'},
      {name: 'i6'},
      {name: 'i7'},
      {name: 'i8'},
      {name: 'i9'},
      {name: 'i10'},
      {name: 'i11'},
      {name: 'i12'},
      {name: 'i13'},
      {name: 'i14'},
      {name: 'i15'}
    ]
  }});
  global.testBoard.connect();
  */

  /*
  // Testing - create a test IO board
  global.testBoard = new Monitor({probeClass:'OutputBoard', initParams:{
    pins: {
      data: 'P9_11',
      clock: 'P9_12',
      latch: 'P9_13',
      enable: 'P9_14'
    },
    outputs: [
      {name: 'o0'},
      {name: 'o1', initialValue: 1},
      {name: 'o2'},
      {name: 'o3', initialValue: 1},
      {name: 'o4'},
      {name: 'o5', initialValue: 1},
      {name: 'o6'},
      {name: 'o7', initialValue: 1},
      {name: 'o8'},
      {name: 'o9', initialValue: 1},
      {name: 'o10'},
      {name: 'o11', initialValue: 1},
      {name: 'o12'},
      {name: 'o13', initialValue: 1},
      {name: 'o14'},
      {name: 'o15', initialValue: 1}
    ]
  }});
  global.testBoard.connect();
  */

}(this));
