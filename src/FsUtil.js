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
// Filesystem utility functions

"use strict";

const App = global.App || { };
const Fs = require ("fs");
const Path = require ("path");
const Os = require ("os");
const Async = require ("async");
const Log = require (App.SOURCE_DIRECTORY + "/Log");

const FS_READ_BLOCK_SIZE = 65536; // bytes

// Create a directory if it does not already exist, and invoke the provided callback when complete, with a non-null "err" parameter if an error occurred. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.createDirectory = function (path, endCallback) {
	let execute = (executeCallback) => {
		let dirStat, dirStatComplete, mkdirComplete;

		dirStat = () => {
			Fs.stat (path, dirStatComplete);
		};

		dirStatComplete = (err, stats) => {
			if ((err != null) && (err.code != "ENOENT")) {
				executeCallback (`Failed to stat directory "${path}"`);
				return;
			}

			if (stats != null) {
				if (! stats.isDirectory ()) {
					executeCallback (`"${path}" already exists as non-directory`);
				}
				else {
					mkdirComplete (null);
				}

				return;
			}

			Fs.mkdir (path, 0o755, mkdirComplete);
		};

		mkdirComplete = (err) => {
			if (err != null) {
				if (err.toString ().indexOf ("EEXIST") >= 0) {
					err = null;
				}

				executeCallback (err);
				return;
			}

			executeCallback (null);
		};

		dirStat ();
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve ();
			});
		}));
	}
};

// Synchronously read the contents of the specified configuration file and return an array of objects containing "type" and "params" fields for each the resulting lines. Lines containing only whitespace or beginning with a # character are ignored. Returns null if the file could not be read.
exports.readConfigFile = function (filename) {
	let hostname, prefix, suffix, pos, configdata, configs, parts, i, line, lineparts, type, params, j, keyparts;

	pos = filename.lastIndexOf (".");
	if (pos >= 0) {
		hostname = Os.hostname ();
		prefix = filename.substring (0, pos);
		suffix = filename.substring (pos);

		// Check for variations on the "filename-hostname.conf" scheme
		line = prefix + "-" + hostname + suffix;
		if (exports.fileExistsSync (line)) {
			filename = line;
		}
		else {
			pos = hostname.indexOf (".");
			if (pos >= 0) {
				line = prefix + "-" + hostname.substring (0, pos) + suffix;
				if (exports.fileExistsSync (line)) {
					filename = line;
				}
			}
		}
	}

	try {
		configdata = Fs.readFileSync (filename, { "encoding" : "UTF8" });
	}
	catch (e) {
		Log.err (`Failed to read configuration file; path=${filename} err=${e}`);
		return (null);
	}

	configs = [ ];
	parts = configdata.split ("\n");
	for (i = 0; i < parts.length; ++i) {
		line = parts[i].trim ();
		if (line.match (/^\s*#/) || line.match (/^\s*$/)) {
			continue;
		}

		type = null;
		params = { };
		lineparts = line.split (",");
		for (j = 0; j < lineparts.length; ++j) {
			if (type === null) {
				type = lineparts[j];
				continue;
			}

			keyparts = lineparts[j].split ("=");
			if (keyparts.length < 2) {
				params[keyparts[0]] = true;
			}
			else {
				params[keyparts[0]] = keyparts[1];
			}
		}

		if (type == null) {
			Log.warn (`Invalid line in configuration file; path=${filename} err="no type value" line=${line}`);
			continue;
		}

		configs.push ({ type : type, params : params });
	}
	return (configs);
};

// Synchronously read the contents of the specified key-value pair configuration file and return an object containing the resulting fields. Lines containing only whitespace or beginning with a # character are ignored. Returns null if the file could not be read.
exports.readConfigKeyFile = function (filename) {
	let hostname, prefix, suffix, configdata, parts, i, line, pos, config;

	pos = filename.lastIndexOf (".");
	if (pos >= 0) {
		hostname = Os.hostname ();
		prefix = filename.substring (0, pos);
		suffix = filename.substring (pos);

		// Check for variations on the "filename-hostname.conf" scheme
		line = prefix + "-" + hostname + suffix;
		if (exports.fileExistsSync (line)) {
			filename = line;
		}
		else {
			pos = hostname.indexOf (".");
			if (pos >= 0) {
				line = prefix + "-" + hostname.substring (0, pos) + suffix;
				if (exports.fileExistsSync (line)) {
					filename = line;
				}
			}
		}
	}

	try {
		configdata = Fs.readFileSync (filename, { "encoding" : "UTF8" });
	}
	catch (e) {
		Log.err (`Failed to read configuration file; path=${filename} err=${e}`);
		return (null);
	}

	config = { };
	parts = configdata.split ("\n");
	for (i = 0; i < parts.length; ++i) {
		line = parts[i].trim ();
		if (line.match (/^\s*#/) || line.match (/^\s*$/)) {
			continue;
		}

		pos = line.indexOf (" ");
		if (pos < 0) {
			config[line] = "";
		}
		else {
			config[line.substring (0, pos)] = line.substring (pos + 1);
		}
	}
	return (config);
};

// Return a size string for the provided number of bytes
exports.getSizeString = function (size) {
	let val;

	if (size > (1024 * 1024 * 1024)) {
		val = size / (1024 * 1024 * 1024);
		return (val.toFixed (2) + "GB");
	}

	if (size > (1024 * 1024)) {
		val = size / (1024 * 1024);
		return (val.toFixed (2) + "MB");
	}

	if (size > 1024) {
		val = size / (1024 * 1024);
		return (val.toFixed (2) + "kB");
	}

	return (size + "B");
};

// Gather file stats for a path and invoke endCallback (err, stats) when complete. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.statFile = function (path, endCallback) {
	let execute = (executeCallback) => {
		Fs.stat (path, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, stats) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (stats);
			});
		}));
	}
};

// Gather stats for all files in fileList and invoke endCallback (err) when complete. If statFunction is provided, invoke statFunction (filename, stats) for each file and generate an error if statFunction does not return true. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.statFiles = function (fileList, statFunction, endCallback) {
	let execute = (executeCallback) => {
		let statFile, statFilesComplete;

		statFile = (file, callback) => {
			Fs.stat (file, (err, stats) => {
				if (err != null) {
					callback (err);
					return;
				}
				if ((typeof statFunction == "function") && (statFunction (file, stats) !== true)) {
					callback ("File failed validation check");
					return;
				}

				callback ();
			});
		};

		statFilesComplete = (err) => {
			if (err != null) {
				executeCallback (err);
				return;
			}

			executeCallback ();
		};

		Async.eachLimit (fileList, 8, statFile, statFilesComplete);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve ();
			});
		}));
	}
};

// Open a file for reading and invoke endCallback (err, fd) when complete. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.openFile = function (path, endCallback) {
	let execute = (executeCallback) => {
		Fs.open (path, "r", 0, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, fd) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (fd);
			});
		}));
	}
};

// Write data to a file and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred). If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.writeFile = function (filename, data, options, endCallback) {
	let execute = (executeCallback) => {
		Fs.writeFile (filename, data, options, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve ();
			});
		}));
	}
};

// Read data from a file and invoke dataCallback (lines, dataEndCallback) for each set of full lines encountered, then invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.readFileLines = function (filename, dataCallback, endCallback) {
	let execute = (executeCallback) => {
		let readfd, buffer, parsedata, openComplete, readComplete, endExecute;

		setTimeout (() => {
			readfd = -1;
			buffer = Buffer.alloc (FS_READ_BLOCK_SIZE);
			parsedata = "";
			exports.openFile (filename, openComplete);
		}, 0);
		openComplete = (err, fd) => {
			if (err != null) {
				endExecute (err);
				return;
			}
			readfd = fd;
			Fs.read (readfd, buffer, 0, FS_READ_BLOCK_SIZE, null, readComplete);
		};
		readComplete = (err, bytesRead, buffer) => {
			let pos, endpos, lines;

			if (err != null) {
				endExecute (err);
				return;
			}

			if (bytesRead <= 0) {
				endExecute ();
				return;
			}

			parsedata += buffer.toString ();
			lines = [ ];
			pos = 0;
			while (true) {
				endpos = parsedata.indexOf ("\n", pos);
				if (endpos < 0) {
					break;
				}

				lines.push (parsedata.substring (pos, endpos));
				pos = endpos + 1;
			}
			parsedata = parsedata.substring (pos);

			if (lines.length <= 0) {
				Fs.read (readfd, buffer, 0, FS_READ_BLOCK_SIZE, null, readComplete);
			}
			else {
				dataCallback (lines, () => {
					Fs.read (readfd, buffer, 0, FS_READ_BLOCK_SIZE, null, readComplete);
				});
			}
		};
		endExecute = (err) => {
			if (readfd >= 0) {
				Fs.close (readfd, () => { });
				readfd = -1;
			}
			executeCallback (err);
		};
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve ();
			});
		}));
	}
};

// Write a state object to a file and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred). If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.writeStateFile = function (filename, state, endCallback) {
	if (typeof endCallback == "function") {
		exports.writeFile (filename, JSON.stringify (state), { "mode" : 0o600 }, endCallback);
	}
	else {
		return (exports.writeFile (filename, JSON.stringify (state), { "mode" : 0o600 }));
	}
};

// Read a previously written state object file and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred) and a "state" parameter (an object containing state data, might be null if the state file was non-existent). If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.readStateFile = function (filename, endCallback) {
	let execute = (executeCallback) => {
		Fs.readFile (filename, readFileComplete);
		function readFileComplete (err, data) {
			let state;

			if (err != null) {
				if ((err.code == "ENOENT") || (err.code == "ENOTDIR")) {
					err = null;
				}
				executeCallback (err, null);
				return;
			}

			state = null;
			try {
				state = JSON.parse (data.toString ());
			}
			catch (e) {
				state = null;
			}

			executeCallback (null, state);
		}
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, state) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (state);
			});
		}));
	}
};

// Read all entries in the specified directory and invoke the provided callback when complete, with "err" and "files" parameters. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.readDirectory = function (directoryPath, endCallback) {
	let execute = (executeCallback) => {
		Fs.readdir (directoryPath, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, files) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (files);
			});
		}));
	}
};

// Remove all files in the specified directory and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred)
exports.removeAllFiles = function (directoryPath, callback) {
	var fileindex, filenames, curfile;

	Fs.readdir (directoryPath, readdirComplete);
	function readdirComplete (err, files) {
		if (err != null) {
			callback (err);
			return;
		}

		filenames = files;
		fileindex = 0;
		checkNextFile ();
	}

	function checkNextFile () {
		if (fileindex >= filenames.length) {
			callback (null);
			return;
		}

		curfile = Path.join (directoryPath, filenames[fileindex]);
		Fs.stat (curfile, statComplete);
	}

	function statComplete (err, stats) {
		if (err != null) {
			callback (err);
			return;
		}

		if (! stats.isFile ()) {
			++fileindex;
			checkNextFile ();
			return;
		}
		Fs.unlink (curfile, unlinkComplete);
	}

	function unlinkComplete (err) {
		if (err != null) {
			callback (err);
			return;
		}

		++fileindex;
		checkNextFile ();
	}
};

// Remove the specified directory, recursing through all contained files and subdirectories, and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred)
exports.removeDirectory = function (directoryPath, callback) {
	var fileindex, filenames, curfile;

	Fs.readdir (directoryPath, readdirComplete);
	function readdirComplete (err, files) {
		if (err != null) {
			if (err.code == "ENOENT") {
				err = null;
			}
			callback (err);
			return;
		}

		filenames = files;
		fileindex = 0;
		checkNextFile ();
	}

	function checkNextFile () {
		if (fileindex >= filenames.length) {
			endCheckFiles ();
			return;
		}

		curfile = Path.join (directoryPath, filenames[fileindex]);
		Fs.stat (curfile, statComplete);
	}

	function statComplete (err, stats) {
		if (err != null) {
			callback (err);
			return;
		}

		if (stats.isDirectory ()) {
			exports.removeDirectory (curfile, removeComplete);
			return;
		}
		Fs.unlink (curfile, removeComplete);
	}

	function removeComplete (err) {
		if (err != null) {
			callback (err);
			return;
		}

		++fileindex;
		checkNextFile ();
	}

	function endCheckFiles () {
		Fs.rmdir (directoryPath, rmdirComplete);
	}

	function rmdirComplete (err) {
		if (err != null) {
			callback (err);
			return;
		}

		callback ();
	}
};

// Scan the specified directory path and recurse into all subdirectories to find available filenames. Invokes the provided callback with err and filename parameters for each file found; a callback with a null filename parameter indicates that no more files are available.
exports.findFiles = function (directoryPath, callback) {
	var fileindex, filenames, curfile;

	Fs.readdir (directoryPath, readdirComplete);
	function readdirComplete (err, files) {
		if (err != null) {
			callback (err, null);
			return;
		}

		filenames = files;
		fileindex = 0;
		checkNextFile ();
	}

	function checkNextFile () {
		if (fileindex >= filenames.length) {
			callback (null, null);
			return;
		}

		curfile = Path.join (directoryPath, filenames[fileindex]);
		Fs.stat (curfile, statComplete);
	}

	function statComplete (err, stats) {
		if (err != null) {
			callback (err, null);
			return;
		}

		if (stats.isDirectory ()) {
			exports.findFiles (curfile, findFilesCallback);
			return;
		}

		if (stats.isFile ()) {
			callback (null, curfile);
		}
		++fileindex;
		checkNextFile ();
	}

	function findFilesCallback (err, filename) {
		if (err != null) {
			callback (err, null);
			return;
		}

		if (typeof filename == "string") {
			callback (null, filename);
		}

		if (filename === null) {
			++fileindex;
			checkNextFile ();
		}
	}
};

// Scan the specified directory path and recurse into all subdirectories to find available filenames. Invokes the provided callback when complete, with "err" (non-null if an error occurred) and "fileList" parameters (an array of filenames, or null if an error occurred). If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.findAllFiles = function (directoryPath, endCallback) {
	let execute = (executeCallback) => {
		let filelist;

		filelist = [ ];
		exports.findFiles (directoryPath, findFilesCallback);
		function findFilesCallback (err, filename) {
			if (err != null) {
				executeCallback (err, null);
				return;
			}

			if (filename == null) {
				executeCallback (null, filelist);
				return;
			}

			filelist.push (filename);
		}
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, fileList) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (fileList);
			});
		}));
	}
};

// Check if the named path exists as a regular file and invoke the provided callback when complete, with "err" and "exists" parameters. If endCallback is not provided, instead return a promise that resolves if the operation succeeds or rejects if it doesn't.
exports.fileExists = function (path, endCallback) {
	let execute = (executeCallback) => {
		Fs.stat (path, (err, stats) => {
			let errstr;

			if (err != null) {
				errstr = "" + err;
				if (errstr.indexOf ("ENOENT") >= 0) {
					executeCallback (null, false);
					return;
				}

				executeCallback (err, null);
				return;
			}

			if (! stats.isFile ()) {
				executeCallback (null, false);
				return;
			}

			executeCallback (null, true);
		});
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, exists) => {
				if (err != null) {
					reject (Error (err));
					return;
				}
				resolve (exists);
			});
		}));
	}
};

// Check if the named file exists and return a boolean value indicating if the file was found
exports.fileExistsSync = function (path) {
	var stat;

	try {
		stat = Fs.statSync (path);
	}
	catch (e) {
		stat = null;
	}

	return ((stat != null) && stat.isFile ());
};

// Synchronously read the contents of the specified list configuration file and return an array containing the resulting values. Lines containing only whitespace or beginning with a # character are ignored. Returns null if the file could not be read.
exports.readConfigListFile = function (filename) {
	var hostname, prefix, suffix, pos, configdata, parts, i, line, pos, config;

	pos = filename.lastIndexOf (".");
	if (pos >= 0) {
		hostname = Os.hostname ();
		prefix = filename.substring (0, pos);
		suffix = filename.substring (pos);

		// Check for variations on the "filename-hostname.conf" scheme
		line = prefix + "-" + hostname + suffix;
		if (exports.fileExistsSync (line)) {
			filename = line;
		}
		else {
			pos = hostname.indexOf (".");
			if (pos >= 0) {
				line = prefix + "-" + hostname.substring (0, pos) + suffix;
				if (exports.fileExistsSync (line)) {
					filename = line;
				}
			}
		}
	}

	try {
		configdata = Fs.readFileSync (filename, { "encoding" : "UTF8" });
	}
	catch (e) {
		Log.err (`Failed to read configuration file; path=${filename} err=${e}`);
		return (null);
	}

	config = [ ];
	parts = configdata.split ("\n");
	for (i = 0; i < parts.length; ++i) {
		line = parts[i].trim ();
		if (line.match (/^\s*#/) || line.match (/^\s*$/)) {
			continue;
		}

		config.push (line.trim ());
	}
	return (config);
};
