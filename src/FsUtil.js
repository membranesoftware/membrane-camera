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
// Filesystem utility functions

"use strict";

const App = global.App || { };
const Fs = require ("fs");
const Path = require ("path");
const Async = require ("async");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));

const FsReadBlockSize = 65536; // bytes

// Create a directory if it does not already exist, and invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.createDirectory = (path, endCallback) => {
	const execute = (executeCallback) => {
		const dirStat = () => {
			Fs.stat (path, dirStatComplete);
		};

		const dirStatComplete = (err, stats) => {
			if ((err != null) && (err.code != "ENOENT")) {
				executeCallback (err);
				return;
			}

			if (stats != null) {
				if (! stats.isDirectory ()) {
					executeCallback (Error (`"${path}" already exists as non-directory`));
				}
				else {
					mkdirComplete (null);
				}
				return;
			}

			Fs.mkdir (path, 0o755, mkdirComplete);
		};

		const mkdirComplete = (err) => {
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
					reject (err);
					return;
				}
				resolve ();
			});
		}));
	}
};

// Synchronously read the contents of the specified configuration file and return an array of objects containing "type" and "params" fields for each the resulting lines. Lines containing only whitespace or beginning with a # character are ignored. Returns null if the file could not be read.
exports.readConfigFile = (filename) => {
	let configdata, line, lineparts, type, params, keyparts;

	try {
		configdata = Fs.readFileSync (filename, { "encoding" : "UTF8" });
	}
	catch (e) {
		Log.err (`Failed to read configuration file; path=${filename} err=${e}`);
		return (null);
	}

	const configs = [ ];
	const parts = configdata.split ("\n");
	for (let i = 0; i < parts.length; ++i) {
		line = parts[i].trim ();
		if (line.match (/^\s*#/) || line.match (/^\s*$/)) {
			continue;
		}

		type = null;
		params = { };
		lineparts = line.split (",");
		for (let j = 0; j < lineparts.length; ++j) {
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

		configs.push ({
			type: type,
			params: params
		});
	}

	return (configs);
};

// Synchronously read the contents of the specified key-value pair configuration file and return an object containing the resulting fields. Lines containing only whitespace or beginning with a # character are ignored. Returns null if the file could not be read.
exports.readConfigKeyFile = (filename) => {
	let configdata, line, pos;

	try {
		configdata = Fs.readFileSync (filename, { "encoding" : "UTF8" });
	}
	catch (e) {
		Log.err (`Failed to read configuration file; path=${filename} err=${e}`);
		return (null);
	}

	const config = { };
	const parts = configdata.split ("\n");
	for (let i = 0; i < parts.length; ++i) {
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

// Gather file stats for a path and invoke endCallback (err, stats) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.statFile = (path, endCallback) => {
	const execute = (executeCallback) => {
		Fs.stat (path, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, stats) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve (stats);
			});
		}));
	}
};

// Gather stats for all files in fileList and invoke endCallback (err) when complete. If statFunction is provided, invoke statFunction (filename, stats) for each file and generate an error if statFunction does not return true. If endCallback is not provided, instead return a promise that executes the operation.
exports.statFiles = (fileList, statFunction, endCallback) => {
	const execute = (executeCallback) => {
		const statFile = (file, callback) => {
			Fs.stat (file, (err, stats) => {
				if (err != null) {
					callback (err);
					return;
				}
				if ((typeof statFunction == "function") && (statFunction (file, stats) !== true)) {
					callback (Error ("File failed validation check"));
					return;
				}

				callback ();
			});
		};

		const statFilesComplete = (err) => {
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
					reject (err);
					return;
				}
				resolve ();
			});
		}));
	}
};

// Open a file for reading and invoke endCallback (err, fd) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.openFile = (path, endCallback) => {
	const execute = (executeCallback) => {
		Fs.open (path, "r", 0, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, fd) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve (fd);
			});
		}));
	}
};

// Write data to a file and invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.writeFile = (filename, data, options, endCallback) => {
	const execute = (executeCallback) => {
		Fs.writeFile (filename, data, options, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve ();
			});
		}));
	}
};

// Read data from a file and invoke dataCallback (lines, dataEndCallback) for each set of full lines encountered, then invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.readFileLines = (filename, dataCallback, endCallback) => {
	const execute = (executeCallback) => {
		let readfd, buffer, parsedata;

		setTimeout (() => {
			readfd = -1;
			buffer = Buffer.alloc (FsReadBlockSize);
			parsedata = "";
			exports.openFile (filename, openComplete);
		}, 0);
		const openComplete = (err, fd) => {
			if (err != null) {
				endExecute (err);
				return;
			}
			readfd = fd;
			Fs.read (readfd, buffer, 0, FsReadBlockSize, null, readComplete);
		};
		const readComplete = (err, bytesRead, buffer) => {
			let pos, endpos;

			if (err != null) {
				endExecute (err);
				return;
			}

			if (bytesRead <= 0) {
				endExecute ();
				return;
			}

			const lines = [ ];
			parsedata += buffer.toString ("utf8", 0, bytesRead);
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
				Fs.read (readfd, buffer, 0, FsReadBlockSize, null, readComplete);
			}
			else {
				dataCallback (lines, () => {
					Fs.read (readfd, buffer, 0, FsReadBlockSize, null, readComplete);
				});
			}
		};
		const endExecute = (err) => {
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
					reject (err);
					return;
				}
				resolve ();
			});
		}));
	}
};

// Write a state object to a file and invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.writeStateFile = (filename, state, endCallback) => {
	if (typeof endCallback == "function") {
		exports.writeFile (filename, JSON.stringify (state), { "mode" : 0o600 }, endCallback);
	}
	else {
		return (exports.writeFile (filename, JSON.stringify (state), { "mode" : 0o600 }));
	}
};

// Read a previously written state object file and invoke endCallback (err, state) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.readStateFile = (filename, endCallback) => {
	const execute = (executeCallback) => {
		Fs.readFile (filename, (err, data) => {
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
		});
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, state) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve (state);
			});
		}));
	}
};

// Read all entries in the specified directory and invoke endCallback (err, files) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.readDirectory = (directoryPath, endCallback) => {
	const execute = (executeCallback) => {
		Fs.readdir (directoryPath, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, files) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve (files);
			});
		}));
	}
};

// Remove all files in the specified directory and invoke callback (err) when complete
exports.removeAllFiles = (directoryPath, callback) => {
	let fileindex, filenames, curfile;

	Fs.readdir (directoryPath, (err, files) => {
		if (err != null) {
			callback (err);
			return;
		}
		filenames = files;
		fileindex = 0;
		checkNextFile ();
	});
	const checkNextFile = () => {
		if (fileindex >= filenames.length) {
			callback (null);
			return;
		}
		curfile = Path.join (directoryPath, filenames[fileindex]);
		Fs.stat (curfile, statComplete);
	};
	const statComplete = (err, stats) => {
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
	};
	const unlinkComplete = (err) => {
		if (err != null) {
			callback (err);
			return;
		}
		++fileindex;
		checkNextFile ();
	};
};

// Remove the specified directory, recursing through all contained files and subdirectories, and invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.removeDirectory = (directoryPath, endCallback) => {
	const execute = async () => {
		let files;

		try {
			files = await exports.readDirectory (directoryPath);
		}
		catch (err) {
			if (err.code != "ENOENT") {
				throw err;
			}
			return;
		}

		for (const file of files) {
			const path = Path.join (directoryPath, file);
			const stats = await exports.statFile (path);
			if (stats.isDirectory ()) {
				await exports.removeDirectory (path);
			}
			else {
				await new Promise ((resolve, reject) => {
					Fs.unlink (path, (err) => {
						if (err) {
							reject (err);
							return;
						}
						resolve ();
					});
				});
			}
		}

		await new Promise ((resolve, reject) => {
			Fs.rmdir (directoryPath, (err) => {
				if (err) {
					reject (err);
					return;
				}
				resolve ();
			});
		});
	};

	if (typeof endCallback == "function") {
		execute ().then (() => {
			endCallback ();
		}).catch ((err) => {
			endCallback (err);
		});
	}
	else {
		return (execute ());
	}
};

// Scan the specified directory path and recurse into all subdirectories to find available filenames. Invokes callback (err, filename) for each file found; a callback providing a null filename indicates that no more files are available.
exports.findFiles = (directoryPath, callback) => {
	let fileindex, filenames, curfile;

	Fs.readdir (directoryPath, (err, files) => {
		if (err != null) {
			callback (err, null);
			return;
		}
		filenames = files;
		fileindex = 0;
		checkNextFile ();
	});
	const checkNextFile = () => {
		if (fileindex >= filenames.length) {
			callback (null, null);
			return;
		}
		curfile = Path.join (directoryPath, filenames[fileindex]);
		Fs.stat (curfile, statComplete);
	};
	const statComplete = (err, stats) => {
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
	};
	const findFilesCallback = (err, filename) => {
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
	};
};

// Scan the specified directory path and recurse into all subdirectories to find available filenames. Invokes endCallback (err, fileList) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.findAllFiles = (directoryPath, endCallback) => {
	const execute = (executeCallback) => {
		const filelist = [ ];
		exports.findFiles (directoryPath, (err, filename) => {
			if (err != null) {
				executeCallback (err, null);
				return;
			}

			if (filename == null) {
				executeCallback (null, filelist);
				return;
			}

			filelist.push (filename);
		});
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err, fileList) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve (fileList);
			});
		}));
	}
};

// Check if the named path exists as a regular file and invoke endCallback (err, exists) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.fileExists = (path, endCallback) => {
	const execute = (executeCallback) => {
		Fs.stat (path, (err, stats) => {
			let errstr;

			if (err != null) {
				errstr = `${err}`;
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
					reject (err);
					return;
				}
				resolve (exists);
			});
		}));
	}
};

// Check if the named file exists and return a boolean value indicating if the file was found
exports.fileExistsSync = (path) => {
	let stat;

	try {
		stat = Fs.statSync (path);
	}
	catch (e) {
		stat = null;
	}

	return ((stat != null) && stat.isFile ());
};

// Rename a file and invoke endCallback (err) when complete. If endCallback is not provided, instead return a promise that executes the operation.
exports.renameFile = (oldPath, newPath, endCallback) => {
	const execute = (executeCallback) => {
		Fs.rename (oldPath, newPath, executeCallback);
	};

	if (typeof endCallback == "function") {
		execute (endCallback);
	}
	else {
		return (new Promise ((resolve, reject) => {
			execute ((err) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve ();
			});
		}));
	}
};
