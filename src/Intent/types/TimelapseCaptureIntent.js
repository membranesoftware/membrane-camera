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
"use strict";

const App = global.App || { };
const Fs = require ("fs");
const Path = require ("path");
const EventEmitter = require ("events").EventEmitter;
const Async = require ("async");
const Result = require (Path.join (App.SOURCE_DIRECTORY, "Result"));
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const FsUtil = require (Path.join (App.SOURCE_DIRECTORY, "FsUtil"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const ExecProcess = require (Path.join (App.SOURCE_DIRECTORY, "ExecProcess"));
const IntentBase = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "IntentBase"));

const CaptureProcessName = "/usr/bin/raspistill";
const MaxImageWidth = 3280;
const MaxImageHeight = 2464;
const MaxCaptureDirectoryCount = 4096;
const PruneTriggerPercent = 98; // Percent of total storage space used
const PruneTargetPercent = 96; // Percent of total storage space used
const CaptureIdleEventName = "captureIdle";

class TimelapseCaptureIntent extends IntentBase {
	constructor () {
		super ();
		this.name = "TimelapseCaptureIntent";
		this.displayName = "Capture timelapse images";
		this.stateType = "TimelapseCaptureIntentState";

		this.captureDirectoryTimes = [ ];
		this.lastCaptureFile = "";
		this.lastCaptureTime = 0;
		this.lastCaptureWidth = 0;
		this.lastCaptureHeight = 0;

		this.isCaptureReady = false;
		this.isScanningDirectory = false;
		this.isCapturing = false;
		this.capturePath = "";
		this.capturePathCount = 0;
		this.eventEmitter = new EventEmitter ();
		this.eventEmitter.setMaxListeners (0);
	}

	// Schedule a callback to be invoked once, on the next occasion when the intent is not actively capturing an image
	onCaptureIdle (callback) {
		if (! this.isCapturing) {
			callback ();
		}
		else {
			this.eventEmitter.once (CaptureIdleEventName, callback);
		}
	}

	// Configure the intent's state using values in the provided params object and return a Result value
	doConfigure (configParams) {
		this.state.capturePeriod = configParams.capturePeriod;

		return (Result.Success);
	}

	// Perform actions appropriate when the intent becomes active
	doStart () {
		if (typeof this.state.nextCaptureTime != "number") {
			this.state.nextCaptureTime = 0;
		}

		const max = Date.now () + (this.state.capturePeriod * 1000);
		if (this.state.nextCaptureTime > max) {
			this.state.nextCaptureTime = max;
		}

		this.dataPath = Path.join (App.DATA_DIRECTORY, App.CameraCachePath);
	}

	// Perform actions appropriate for the current state of the application
	doUpdate () {
		let shouldcapture;

		if (! this.isCaptureReady) {
			if (! this.isScanningDirectory) {
				this.scanDirectory ();
			}
			return;
		}

		if (! this.isCapturing) {
			shouldcapture = false;
			if (this.updateTime >= this.state.nextCaptureTime) {
				shouldcapture = true;
			}
			if (shouldcapture) {
				const server = App.systemAgent.getServer ("CameraServer");
				if ((server != null) && server.isCapturingVideo) {
					shouldcapture = false;
				}
			}
			if (shouldcapture) {
				this.captureImage ();
				this.state.nextCaptureTime = this.updateTime + (this.state.capturePeriod * 1000);
			}
		}
	}

	// Execute operations to read cache directories and file metadata, then prepare the cache directory to store capture images
	scanDirectory () {
		this.isScanningDirectory = true;

		TimelapseCaptureIntent.readCacheSummary (this.dataPath).then ((resultObject) => {
			this.captureDirectoryTimes = resultObject.captureDirectoryTimes;
			this.capturePath = resultObject.capturePath;
			this.capturePathCount = resultObject.capturePathCount;
			this.lastCaptureFile = resultObject.lastCaptureFile;
			this.lastCaptureTime = resultObject.lastCaptureTime;
			this.lastCaptureWidth = resultObject.lastCaptureWidth;
			this.lastCaptureHeight = resultObject.lastCaptureHeight;
		}).catch ((err) => {
			Log.err (`${this.toString ()} failed to scan directory; dataPath=${this.dataPath} err=${err}`);
		}).then (() => {
			this.isScanningDirectory = false;
			this.isCaptureReady = true;
		});
	}

	// Execute operations to capture and store a camera image
	captureImage () {
		let imagepath, imageprofile, imagewidth, imageheight, imagetime;

		this.isCapturing = true;
		if ((this.capturePath == "") || (this.capturePathCount >= MaxCaptureDirectoryCount)) {
			const now = Date.now ();
			this.capturePath = Path.join (this.dataPath, `${now}`);
			this.captureDirectoryTimes.push (now);
			this.capturePathCount = 0;
		}
		FsUtil.createDirectory (this.capturePath).then (() => {
			return (new Promise ((resolve, reject) => {
				const args = [
					"-t", "1",
					"-e", "jpg",
					"-q", "97"
				];

				imageprofile = SystemInterface.Constant.DefaultImageProfile;
				if ((App.systemAgent.runState.cameraConfiguration != null) && (typeof App.systemAgent.runState.cameraConfiguration.imageProfile == "number")) {
					imageprofile = App.systemAgent.runState.cameraConfiguration.imageProfile;
				}
				switch (imageprofile) {
					case SystemInterface.Constant.HighQualityImageProfile: {
						imagewidth = MaxImageWidth;
						imageheight = MaxImageHeight;
						break;
					}
					case SystemInterface.Constant.LowQualityImageProfile: {
						imagewidth = Math.floor (MaxImageWidth / 4);
						imageheight = Math.floor (MaxImageHeight / 4);
						break;
					}
					case SystemInterface.Constant.LowestQualityImageProfile: {
						imagewidth = Math.floor (MaxImageWidth / 8);
						imageheight = Math.floor (MaxImageHeight / 8);
						break;
					}
					default: {
						imagewidth = Math.floor (MaxImageWidth / 2);
						imageheight = Math.floor (MaxImageHeight / 2);
						break;
					}
				}

				if (imagewidth < 1) {
					imagewidth = 1;
				}
				if (imageheight < 1) {
					imageheight = 1;
				}
				args.push ("-w", imagewidth);
				args.push ("-h", imageheight);

				if ((App.systemAgent.runState.cameraConfiguration != null) && (typeof App.systemAgent.runState.cameraConfiguration.flip == "number")) {
					switch (App.systemAgent.runState.cameraConfiguration.flip) {
						case SystemInterface.Constant.HorizontalFlip: {
							args.push ("-hf");
							break;
						}
						case SystemInterface.Constant.VerticalFlip: {
							args.push ("-vf");
							break;
						}
						case SystemInterface.Constant.HorizontalAndVerticalFlip: {
							args.push ("-hf");
							args.push ("-vf");
							break;
						}
					}
				}

				imagetime = Date.now ();
				imagepath = Path.join (this.capturePath, `${imagetime}_${imagewidth}x${imageheight}.jpg`);
				args.push ("-o", imagepath);
				new ExecProcess (CaptureProcessName, args, { }, this.dataPath, null, (err, isExitSuccess) => {
					if (err != null) {
						reject (err);
						return;
					}
					if (! isExitSuccess) {
						reject (Error ("Image capture process ended with non-success result"));
						return;
					}

					resolve ();
				});
			}));
		}).then (() => {
			return (FsUtil.fileExists (imagepath))
		}).then ((exists) => {
			if (! exists) {
				return (Promise.reject (Error ("Image capture process failed to create output file")));
			}

			return (Promise.resolve ());
		}).then (() => {
			return (this.pruneCacheFiles ());
		}).then (() => {
			this.lastCaptureFile = imagepath;
			this.lastCaptureTime = imagetime;
			this.lastCaptureWidth = imagewidth;
			this.lastCaptureHeight = imageheight;
			++(this.capturePathCount);

			const server = App.systemAgent.getServer ("CameraServer");
			if (server != null) {
				server.captureDirectoryTimes = this.captureDirectoryTimes;
				server.lastCaptureFile = this.lastCaptureFile;
				server.lastCaptureTime = this.lastCaptureTime;
				server.lastCaptureWidth = this.lastCaptureWidth;
				server.lastCaptureHeight = this.lastCaptureHeight;
				if (server.minCaptureTime <= 0) {
					server.minCaptureTime = server.lastCaptureTime;
				}
				server.getDiskSpaceTask.setNextRepeat (0);
			}
		}).catch ((err) => {
			Log.err (`${this.toString ()} failed to capture image; capturePath=${this.capturePath} err=${err}`);
		}).then (() => {
			this.isCapturing = false;
			this.eventEmitter.emit (CaptureIdleEventName);
		});
	}

	// Return a promise that removes the oldest files from the cache as needed to maintain the configured percentage of free storage space
	pruneCacheFiles () {
		return (new Promise ((resolve, reject) => {
			let bytes, shouldrefresh;

			const server = App.systemAgent.getServer ("CameraServer");
			if ((server == null) || (server.totalStorage <= 0) || (this.captureDirectoryTimes.length <= 0)) {
				resolve ();
				return;
			}

			bytes = server.freeStorage;
			const pct = 100 - ((bytes / server.totalStorage) * 100);
			if (pct < PruneTriggerPercent) {
				resolve ();
				return;
			}

			shouldrefresh = false;
			const targetbytes = Math.floor ((server.totalStorage * (100 - PruneTargetPercent)) / 100);
			const dirpath = Path.join (this.dataPath, `${this.captureDirectoryTimes[0]}`);
			FsUtil.readDirectory (dirpath).then ((files) => {
				const imagefiles = [ ];
				const targetfiles = [ ];
				for (const file of files) {
					const f = TimelapseCaptureIntent.parseImageFilename (file);
					if (f != null) {
						imagefiles.push (Path.join (dirpath, file));
					}
					else {
						targetfiles.push (Path.join (dirpath, file));
					}
				}

				imagefiles.sort ((a, b) => {
					if (a.time < b.time) {
						return (-1);
					}
					if (a.time > b.time) {
						return (1);
					}
					return (0);
				});

				return (new Promise ((resolve, reject) => {
					const statFile = (file, callback) => {
						FsUtil.statFile (file, (err, stats) => {
							if (err != null) {
								callback (err);
								return;
							}

							if (bytes < targetbytes) {
								targetfiles.push (file);
								bytes += stats.size;
							}
							callback ();
						});
					};

					const endSeries = (err) => {
						if (err != null) {
							reject (err);
							return;
						}

						resolve (targetfiles);
					};

					Async.eachSeries (imagefiles, statFile, endSeries);
				}));
			}).then ((targetFiles) => {
				return (new Promise ((resolve, reject) => {
					if (targetFiles.length <= 0) {
						resolve ();
						return;
					}

					shouldrefresh = true;
					const unlinkFile = (file, callback) => {
						Fs.unlink (file, (err) => {
							if (err != null) {
								callback (err);
								return;
							}

							callback ();
						});
					};

					const endSeries = (err) => {
						if (err != null) {
							reject (err);
							return;
						}

						resolve ();
					};

					Async.eachSeries (targetFiles, unlinkFile, endSeries);
				}));
			}).then (() => {
				return (FsUtil.readDirectory (dirpath));
			}).then ((files) => {
				if ((! Array.isArray (files)) || (files.length > 0)) {
					return (Promise.resolve ());
				}

				shouldrefresh = true;
				return (new Promise ((resolve, reject) => {
					Fs.rmdir (dirpath, (err) => {
						if (err != null) {
							reject (err);
							return;
						}

						resolve ();
					});
				}));
			}).then (() => {
				if (! shouldrefresh) {
					return (Promise.resolve (null));
				}

				return (TimelapseCaptureIntent.readCacheSummary (this.dataPath));
			}).then ((resultObject) => {
				if (resultObject != null) {
					this.captureDirectoryTimes = resultObject.captureDirectoryTimes;
					this.capturePath = resultObject.capturePath;
					this.capturePathCount = resultObject.capturePathCount;
					this.lastCaptureFile = resultObject.lastCaptureFile;
					this.lastCaptureTime = resultObject.lastCaptureTime;
					this.lastCaptureWidth = resultObject.lastCaptureWidth;
					this.lastCaptureHeight = resultObject.lastCaptureHeight;
					server.captureDirectoryTimes = resultObject.captureDirectoryTimes;
					server.lastCaptureFile = resultObject.lastCaptureFile;
					server.lastCaptureTime = resultObject.lastCaptureTime;
					server.lastCaptureWidth = resultObject.lastCaptureWidth;
					server.lastCaptureHeight = resultObject.lastCaptureHeight;
					server.minCaptureTime = resultObject.minCaptureTime;
				}
				resolve ();
			}).catch ((err) => {
				reject (err);
			});
		}));
	}
}

// Parse the provided capture image filename and return an object with the resulting fields, or null if the parse failed
TimelapseCaptureIntent.parseImageFilename = function (filename) {
	const matches = filename.match (/^([0-9]+)_([0-9]+)x([0-9]+)\.jpg$/);
	if (matches == null) {
		return (null);
	}

	const t = parseInt (matches[1], 10);
	const w = parseInt (matches[2], 10);
	const h = parseInt (matches[3], 10);
	if (isNaN (t) || isNaN (w) || isNaN (h)) {
		return (null);
	}

	return ({
		time: t,
		width: w,
		height: h
	});
};

// Return a promise that reads summary metadata from files in the specified cache path
TimelapseCaptureIntent.readCacheSummary = function (cachePath) {
	return (new Promise ((resolve, reject) => {
		const result = {
			captureDirectoryTimes: [ ],
			minCaptureTime: 0,
			lastCaptureFile: "",
			lastCaptureTime: 0,
			lastCaptureWidth: 0,
			lastCaptureHeight: 0,
			capturePath: "",
			capturePathCount: 0
		};
		FsUtil.readDirectory (cachePath).then ((files) => {
			return (new Promise ((resolve, reject) => {
				const statDirectory = (file, callback) => {
					if (! file.match (/^[0-9]+$/)) {
						process.nextTick (callback);
						return;
					}
					FsUtil.statFile (Path.join (cachePath, file), (err, stats) => {
						if ((err == null) && (stats != null) && stats.isDirectory ()) {
							result.captureDirectoryTimes.push (parseInt (file, 10));
						}
						callback ();
					});
				};

				const endSeries = (err) => {
					if (err != null) {
						reject (Error (err));
						return;
					}
					result.captureDirectoryTimes.sort ((a, b) => {
						if (isNaN (a) || isNaN (b) || (a == b)) {
							return (0);
						}
						if (a < b) {
							return (-1);
						}
						return (1);
					});
					resolve ();
				};

				Async.eachSeries (files, statDirectory, endSeries);
			}));
		}).then (() => {
			return (new Promise ((resolve, reject) => {
				if (result.captureDirectoryTimes.length <= 0) {
					resolve ();
					return;
				}

				FsUtil.readDirectory (Path.join (cachePath, `${result.captureDirectoryTimes[0]}`), (err, files) => {
					if (err != null) {
						reject (Error (err));
						return;
					}

					for (const file of files) {
						const f = TimelapseCaptureIntent.parseImageFilename (file);
						if ((f != null) && (f.time > 0)) {
							if ((result.minCaptureTime <= 0) || (f.time < result.minCaptureTime)) {
								result.minCaptureTime = f.time;
							}
						}
					}

					resolve ();
				});
			}));
		}).then (() => {
			return (new Promise ((resolve, reject) => {
				if (result.captureDirectoryTimes.length <= 0) {
					resolve ();
					return;
				}

				result.capturePath = Path.join (cachePath, `${result.captureDirectoryTimes[result.captureDirectoryTimes.length - 1]}`);
				FsUtil.readDirectory (result.capturePath, (err, files) => {
					if (err != null) {
						reject (Error (err));
						return;
					}

					result.lastCaptureFile = "";
					result.lastCaptureTime = 0;
					result.capturePathCount = 0;
					for (const file of files) {
						const f = TimelapseCaptureIntent.parseImageFilename (file);
						if ((f != null) && (f.time > 0)) {
							++(result.capturePathCount);
							if (f.time > result.lastCaptureTime) {
								result.lastCaptureTime = f.time;
								result.lastCaptureWidth = f.width;
								result.lastCaptureHeight = f.height;
								result.lastCaptureFile = file;
							}
						}
					}
					if (result.lastCaptureFile != "") {
						result.lastCaptureFile = Path.join (result.capturePath, result.lastCaptureFile);
					}

					resolve ();
				});
			}));
		}).then (() => {
			resolve (result);
		}).catch ((err) => {
			Log.err (`Failed to read cache data; path=${cachePath} err=${err}`);
			reject (Error (err));
		});
	}));
};

// Return a promise that finds cache images in the range specified by the provided FindCaptureImages command, resolving with a set of FindCaptureImagesResult fields if successful
TimelapseCaptureIntent.findCaptureImages = function (cmdInv, cameraServer) {
	return (new Promise ((resolve, reject) => {
		let mintime, maxtime, i, sortCompare;

		const result = {
			captureTimes: [ ]
		};
		if ((! Array.isArray (cameraServer.captureDirectoryTimes)) || (cameraServer.captureDirectoryTimes.length <= 0)) {
			resolve (result);
			return;
		}
		mintime = cmdInv.params.minTime;
		if (mintime <= 0) {
			mintime = cameraServer.minCaptureTime;
		}
		maxtime = cmdInv.params.maxTime;
		if (maxtime <= 0) {
			maxtime = cameraServer.lastCaptureTime;
		}

		const dirpaths = [ ];
		if (cmdInv.params.isDescending) {
			i = cameraServer.captureDirectoryTimes.length - 1;
			while (i > 0) {
				if (cameraServer.captureDirectoryTimes[i] <= maxtime) {
					break;
				}
				--i;
			}
			while (i >= 0) {
				dirpaths.push (Path.join (cameraServer.cacheDataPath, `${cameraServer.captureDirectoryTimes[i]}`));
				--i;
			}

			sortCompare = (a, b) => {
				if (a < b) {
					return (1);
				}
				if (a > b) {
					return (-1);
				}
				return (0);
			};
		}
		else {
			i = 0;
			while (i < (cameraServer.captureDirectoryTimes.length - 1)) {
				if (cameraServer.captureDirectoryTimes[i] <= mintime) {
					break;
				}
				++i;
			}
			while (i < cameraServer.captureDirectoryTimes.length) {
				dirpaths.push (Path.join (cameraServer.cacheDataPath, `${cameraServer.captureDirectoryTimes[i]}`));
				++i;
			}

			sortCompare = (a, b) => {
				if (a < b) {
					return (-1);
				}
				if (a > b) {
					return (1);
				}
				return (0);
			};
		}

		const readDirectory = (path, callback) => {
			if ((cmdInv.params.maxResults > 0) && (result.captureTimes.length >= cmdInv.params.maxResults)) {
				process.nextTick (callback);
				return;
			}
			FsUtil.readDirectory (path, (err, files) => {
				if (err != null) {
					callback (err);
					return;
				}

				const times = [ ];
				for (const file of files) {
					const f = TimelapseCaptureIntent.parseImageFilename (file);
					if (f != null) {
						times.push (f.time);
					}
				}
				times.sort (sortCompare);

				for (const t of times) {
					if ((t >= mintime) && (t <= maxtime)) {
						result.captureTimes.push (t);
						if ((cmdInv.params.maxResults > 0) && (result.captureTimes.length >= cmdInv.params.maxResults)) {
							break;
						}
					}
				}

				callback ();
			});
		};

		const endSeries = (err) => {
			if (err != null) {
				reject (err);
				return;
			}
			resolve (result);
		};

		Async.eachSeries (dirpaths, readDirectory, endSeries);
	}));
};

// Return a promise that finds the path for the cache image specified by the provided GetCaptureImage command, resolving with a non-empty path value if successful, or an empty path value for a file not found result
TimelapseCaptureIntent.getCaptureImagePath = function (cmdInv, cameraServer) {
	return (new Promise ((resolve, reject) => {
		let dirtime;

		dirtime = 0;
		for (const t of cameraServer.captureDirectoryTimes) {
			if (t > cmdInv.params.imageTime) {
				break;
			}
			dirtime = t;
		}

		if (dirtime <= 0) {
			resolve ("");
			return;
		}

		const dirpath = Path.join (cameraServer.cacheDataPath, `${dirtime}`);
		FsUtil.readDirectory (dirpath, (err, files) => {
			let result;

			if (err != null) {
				reject (err);
				return;
			}

			result = "";
			for (const file of files) {
				if (file.indexOf (`${cmdInv.params.imageTime}`) === 0) {
					result = Path.join (dirpath, file);
					break;
				}
			}

			resolve (result);
		});
	}));
};
module.exports = TimelapseCaptureIntent;
