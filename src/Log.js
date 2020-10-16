/*
* Copyright 2019-2020 Membrane Software <author@membranesoftware.com> https://membranesoftware.com
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
const Fs = require ("fs");
const Path = require ("path");

exports.ErrLevel = 0;
exports.WarningLevel = 1;
exports.NoticeLevel = 2;
exports.InfoLevel = 3;
exports.DebugLevel = 4;
exports.Debug1Level = 5;
exports.Debug2Level = 6;
exports.Debug3Level = 7;
exports.Debug4Level = 8;
exports.LevelCount = 9;

const logLevelNames = [ "ERR", "WARNING", "NOTICE", "INFO", "DEBUG", "DEBUG1", "DEBUG2", "DEBUG3", "DEBUG4" ];
let logLevel = exports.InfoLevel;
let isConsoleOutputEnabled = false;
let isFileOutputEnabled = true;
let logFilename = "";

// Write a message to the log
exports.write = (level, message) => {
	if (!(isConsoleOutputEnabled || isFileOutputEnabled)) {
		return;
	}
	if ((level < 0) || (level >= exports.LevelCount)) {
		return;
	}
	if (level > logLevel) {
		return;
	}

	const now = new Date ();
	const output = `[${exports.getDateString (now)}][${logLevelNames[level]}] ${message}`;
	if (isConsoleOutputEnabled) {
		console.log (output);
	}
	if (isFileOutputEnabled) {
		if (logFilename == "") {
			logFilename = Path.join (App.DATA_DIRECTORY, "main.log");
		}
		try {
			Fs.appendFileSync (logFilename, `${output}\n`, { "mode" : 0o644 });
		}
		catch (err) {
			if (isConsoleOutputEnabled) {
				console.log (`Log file write error: ${err}`);
			}
		}
	}
};

// Write a message to the log at the ERR level
exports.err = (message) => {
	exports.write (exports.ErrLevel, message);
};

// Write a message to the log at the ERR level
exports.error = (message) => {
	exports.write (exports.ErrLevel, message);
};

// Write a message to the log at the WARNING level
exports.warn = (message) => {
	exports.write (exports.WarningLevel, message);
};

// Write a message to the log at the WARNING level
exports.warning = (message) => {
	exports.write (exports.WarningLevel, message);
};

// Write a message to the log at the NOTICE level
exports.notice = (message) => {
	exports.write (exports.NoticeLevel, message);
};

// Write a message to the log at the INFO level
exports.info = (message) => {
	exports.write (exports.InfoLevel, message);
};

// Write a message to the log at the DEBUG level
exports.debug = (message) => {
	exports.write (exports.DebugLevel, message);
};

// Write a message to the log at the DEBUG1 level
exports.debug1 = (message) => {
	exports.write (exports.Debug1Level, message);
};

// Write a message to the log at the DEBUG2 level
exports.debug2 = (message) => {
	exports.write (exports.Debug2Level, message);
};

// Write a message to the log at the DEBUG3 level
exports.debug3 = (message) => {
	exports.write (exports.Debug3Level, message);
};

// Write a message to the log at the DEBUG4 level
exports.debug4 = (message) => {
	exports.write (exports.Debug4Level, message);
};

// Set the state of the log's console output option. If enabled, log messages are written to the console.
exports.setConsoleOutput = (enable) => {
	isConsoleOutputEnabled = enable;
};

// Set the state of the log's file output option. If enabled, log messages are written to a file.
exports.setFileOutput = (enable) => {
	isFileOutputEnabled = enable;
};

// Set the output filename for the log
exports.setLogFilename = (filename) => {
	if (typeof filename == "string") {
		logFilename = filename;
	}
};

// Return a formatted string generated from the provided Date object
exports.getDateString = (d) => {
	let month, day, hour, minute, second, ms;

	const year = `${d.getFullYear ()}`;
	month = `${d.getMonth () + 1}`;
	if (month.length < 2) {
		month = `0${month}`;
	}

	day = `${d.getDate ()}`;
	if (day.length < 2) {
		day = `0${day}`;
	}

	hour = `${d.getHours ()}`;
	if (hour.length < 2) {
		hour = `0${hour}`;
	}

	minute = `${d.getMinutes ()}`;
	if (minute.length < 2) {
		minute = `0${minute}`;
	}

	second = `${d.getSeconds ()}`;
	if (second.length < 2) {
		second = `0${second}`;
	}

	ms = `${d.getMilliseconds ()}`;
	while (ms.length < 3) {
		ms = `0${ms}`;
	}

	return (`${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`);
};

// Set the log level
exports.setLevel = (level) => {
	if ((typeof level != "number") || (level < 0) || (level >= exports.LevelCount)) {
		return;
	}

	logLevel = Math.floor (level);
};

// Set the log level using the provided name. Returns true if the name was recognized, or false if not.
exports.setLevelByName = (levelName) => {
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
