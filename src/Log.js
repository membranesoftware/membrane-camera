/*
* Copyright 2019 Membrane Software <author@membranesoftware.com>
*                 https://membranesoftware.com
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice,
* this list of conditions and the following disclaimer.
*
* 2. Redistributions in binary form must reproduce the above copyright notice,
* this list of conditions and the following disclaimer in the documentation
* and/or other materials provided with the distribution.
*
* 3. Neither the name of the copyright holder nor the names of its contributors
* may be used to endorse or promote products derived from this software without
* specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
* AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
* IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
* ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
* LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
* CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
* SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
* INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
* CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
* ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
* POSSIBILITY OF SUCH DAMAGE.
*/
// Class that handles application logging functions

"use strict";

const App = global.App || { };
const Fs = require ('fs');
const Path = require ('path');

exports.ERR = 0;
exports.WARNING = 1;
exports.NOTICE = 2;
exports.INFO = 3;
exports.DEBUG = 4;
exports.DEBUG1 = 5;
exports.DEBUG2 = 6;
exports.DEBUG3 = 7;
exports.DEBUG4 = 8;
exports.NUM_LEVELS = 9;

var logLevel = exports.INFO;
var logLevelNames = [ "ERR", "WARNING", "NOTICE", "INFO", "DEBUG", "DEBUG1", "DEBUG2", "DEBUG3", "DEBUG4" ];
var isConsoleOutputEnabled = false;
var isFileOutputEnabled = true;
var logFilename = "";

// Write a message to the log
exports.write = function (level, message) {
	let now, output;

	if (!(isConsoleOutputEnabled || isFileOutputEnabled)) {
		return;
	}
	if ((level < 0) || (level >= exports.NUM_LEVELS)) {
		return;
	}
	if (level > logLevel) {
		return;
	}

	now = new Date ();
	output = '[' + exports.getDateString (now) + ']' + '[' + logLevelNames[level] + '] ' + message;
	if (isConsoleOutputEnabled) {
		console.log (output);
	}
	if (isFileOutputEnabled) {
		if (logFilename == "") {
			logFilename = Path.join (App.DATA_DIRECTORY, "main.log");
		}
		try {
			Fs.appendFileSync (logFilename, output + "\n", { 'mode' : 0o644 });
		}
		catch (e) {
			// Do nothing
		}
	}
};

// Write a message to the log at the ERR level
exports.err = function (message) {
	exports.write (exports.ERR, message);
};

// Write a message to the log at the WARNING level
exports.warn = function (message) {
	exports.write (exports.WARNING, message);
};

// Write a message to the log at the WARNING level
exports.warning = function (message) {
	exports.write (exports.WARNING, message);
};

// Write a message to the log at the NOTICE level
exports.notice = function (message) {
	exports.write (exports.NOTICE, message);
};

// Write a message to the log at the INFO level
exports.info = function (message) {
	exports.write (exports.INFO, message);
};

// Write a message to the log at the DEBUG level
exports.debug = function (message) {
	exports.write (exports.DEBUG, message);
};

// Write a message to the log at the DEBUG1 level
exports.debug1 = function (message) {
	exports.write (exports.DEBUG1, message);
};

// Write a message to the log at the DEBUG2 level
exports.debug2 = function (message) {
	exports.write (exports.DEBUG2, message);
};

// Write a message to the log at the DEBUG3 level
exports.debug3 = function (message) {
	exports.write (exports.DEBUG3, message);
};

// Write a message to the log at the DEBUG4 level
exports.debug4 = function (message) {
	exports.write (exports.DEBUG4, message);
};

// Set the state of the log's console output option. If enabled, log messages are written to the console.
exports.setConsoleOutput = function (enable) {
	isConsoleOutputEnabled = enable;
};

// Set the state of the log's file output option. If enabled, log messages are written to a file.
exports.setFileOutput = function (enable) {
	isFileOutputEnabled = enable;
};

// Set the output filename for the log
exports.setLogFilename = function (filename) {
	if (typeof filename == "string") {
		logFilename = filename;
	}
};

// Return a formatted string generated from the provided Date object
exports.getDateString = function (d) {
	let year, month, day, hour, minute, second, ms;

	year = '' + d.getFullYear ();
	month = '' + (d.getMonth () + 1);
	if (month.length < 2) {
		month = '0' + month;
	}

	day = '' + d.getDate ();
	if (day.length < 2) {
		day = '0' + day;
	}

	hour = '' + d.getHours ();
	if (hour.length < 2) {
		hour = '0' + hour;
	}

	minute = '' + d.getMinutes ();
	if (minute.length < 2) {
		minute = '0' + minute;
	}

	second = '' + d.getSeconds ();
	if (second.length < 2) {
		second = '0' + second;
	}

	ms = '' + d.getMilliseconds ();
	while (ms.length < 3) {
		ms = '0' + ms;
	}

	return (year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second + '.' + ms);
};

// Return a formatted duration string generated from the provided number of milliseconds
exports.getDurationString = function (ms) {
	let duration, t, s;

	duration = '';
	t = ms;
	t /= 1000;
	if (t >= 86400) {
		duration += Math.floor (t / 86400) + 'd ';
		t %= 86400;
	}

	s = '' + Math.floor (t / 3600);
	if (s.length < 2) {
		s = '0' + s;
	}
	duration += s;
	t %= 3600;

	s = '' + Math.floor (t / 60);
	if (s.length < 2) {
		s = '0' + s;
	}
	duration += ':' + s;
	t %= 60;

	s = '' + Math.floor (t);
	if (s.length < 2) {
		s = '0' + s;
	}
	duration += ':' + s;

	return (duration);
};

// Set the log level
exports.setLevel = function (level) {
	if ((typeof level != "number") || (level < 0) || (level >= exports.NUM_LEVELS)) {
		return;
	}

	logLevel = Math.floor (level);
};

// Set the log level using the provided name. Returns true if the name was recognized, or false if not.
exports.setLevelByName = function (levelName) {
	let i, result;

	result = false;
	for (i = 0; i < logLevelNames.length; ++i) {
		if (logLevelNames[i] == levelName) {
			logLevel = i;
			result = true;
			break;
		}
	}

	return (result);
};
