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
"use strict";

const App = global.App || { };
const Path = require ("path");
const Fs = require ("fs");
const Result = require (App.SOURCE_DIRECTORY + "/Result");
const Log = require (App.SOURCE_DIRECTORY + "/Log");
const SystemInterface = require (App.SOURCE_DIRECTORY + "/SystemInterface");
const FsUtil = require (App.SOURCE_DIRECTORY + "/FsUtil");
const RepeatTask = require (App.SOURCE_DIRECTORY + "/RepeatTask");
const Intent = require (App.SOURCE_DIRECTORY + "/Intent/Intent");
const Task = require (App.SOURCE_DIRECTORY + "/Task/Task");
const TimelapseCaptureIntent = require (App.SOURCE_DIRECTORY + "/Intent/types/TimelapseCaptureIntent");
const ServerBase = require (App.SOURCE_DIRECTORY + "/Server/ServerBase");

const CAPTURE_IMAGE_PATH = "/camera/image.jpg";
const GET_DISK_SPACE_PERIOD = 7 * 60 * 1000; // milliseconds

class CameraServer extends ServerBase {
	constructor () {
		super ();
		this.name = "CameraServer";
		this.description = "Accept and execute commands to control a camera device";

		this.configureParams = [
		];

		this.isReady = false;
		this.totalStorage = 0; // bytes
		this.freeStorage = 0; // bytes
		this.usedStorage = 0; // bytes
		this.getDiskSpaceTask = new RepeatTask ();
		this.cacheDataPath = Path.join (App.DATA_DIRECTORY, App.CAMERA_CACHE_PATH);

		this.clearCacheMetadata ();
	}

	// Reset stored cache metadata fields to empty values
	clearCacheMetadata () {
		this.captureDirectoryTimes = [ ];
		this.minCaptureTime = 0;
		this.lastCaptureFile = "";
		this.lastCaptureTime = 0;
		this.lastCaptureWidth = 0;
		this.lastCaptureHeight = 0;
	}

	// Start the server's operation and invoke the provided callback when complete, with an "err" parameter (non-null if an error occurred)
	doStart (startCallback) {
		FsUtil.createDirectory (this.cacheDataPath).then (() => {
			return (Task.executeTask ("GetDiskSpace", { targetPath: this.cacheDataPath }));
		}).then ((resultObject) => {
			this.totalStorage = resultObject.total;
			this.usedStorage = resultObject.used;
			this.freeStorage = resultObject.free;

			return (TimelapseCaptureIntent.readCacheSummary (this.cacheDataPath));
		}).then ((resultObject) => {
			this.captureDirectoryTimes = resultObject.captureDirectoryTimes;
			this.minCaptureTime = resultObject.minCaptureTime;
			this.lastCaptureFile = resultObject.lastCaptureFile;
			this.lastCaptureTime = resultObject.lastCaptureTime;
			this.lastCaptureWidth = resultObject.lastCaptureWidth;
			this.lastCaptureHeight = resultObject.lastCaptureHeight;

			this.getDiskSpaceTask.setRepeating ((callback) => {
				Task.executeTask ("GetDiskSpace", { targetPath: this.cacheDataPath }).then ((resultObject) => {
					this.totalStorage = resultObject.total;
					this.usedStorage = resultObject.used;
					this.freeStorage = resultObject.free;
					callback ();
				}).catch ((err) => {
					callback ();
				});
			}, GET_DISK_SPACE_PERIOD);

			App.systemAgent.addInvokeRequestHandler ("/", SystemInterface.Constant.Camera, (cmdInv) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.CreateTimelapseCaptureIntent: {
						return (this.createTimelapseCaptureIntent (cmdInv));
					}
					case SystemInterface.CommandId.StopCapture: {
						return (this.stopCapture (cmdInv));
					}
					case SystemInterface.CommandId.ClearTimelapse: {
						return (this.clearTimelapse (cmdInv));
					}
				}
			});

			App.systemAgent.addSecondaryRequestHandler (CAPTURE_IMAGE_PATH, (cmdInv, request, response) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.GetCaptureImage: {
						this.getCaptureImage (cmdInv, request, response);
						break;
					}
					default: {
						App.systemAgent.endRequest (request, response, 400, "Bad request");
						break;
					}
				}
			});

			App.systemAgent.addLinkCommandHandler (SystemInterface.Constant.Camera, (client, cmdInv) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.FindCaptureImages: {
						this.findCaptureImages (client, cmdInv);
						break;
					}
				}
			});

			this.isReady = true;
			startCallback ();
		}).catch ((err) => {
			startCallback (err);
		});
	}

	// Return a command invocation containing the server's status
	doGetStatus () {
		let params, intent;

		params = {
			isReady: this.isReady,
			freeStorage: this.freeStorage,
			totalStorage: this.totalStorage,
			captureImagePath: CAPTURE_IMAGE_PATH,
			minCaptureTime: this.minCaptureTime,
			lastCaptureTime: this.lastCaptureTime,
			lastCaptureWidth: this.lastCaptureWidth,
			lastCaptureHeight: this.lastCaptureHeight
		};

		intent = this.getTimelapseCaptureIntent ();
		if (intent == null) {
			params.isCapturing = false;
			params.capturePeriod = 0;
			params.imageProfile = 0;
		}
		else {
			params.isCapturing = true;
			params.capturePeriod = intent.state.capturePeriod;
			params.imageProfile = intent.state.imageProfile;
		}

		return (this.createCommand ("CameraServerStatus", SystemInterface.Constant.Camera, params));
	}

	// Return the active TimelapseCaptureIntent object, or null if no such object was found
	getTimelapseCaptureIntent () {
		let intents;

		intents = App.systemAgent.findIntents (this.name, true);
		if (intents.length <= 0) {
			return (null);
		}

		return (intents[0]);
	}

	// Start an intent to capture timelapse images and return a CommandResult command
	createTimelapseCaptureIntent (cmdInv) {
		let intent, params;

		params = {
			success: false,
			error: ""
		};
		intent = Intent.createIntent ("TimelapseCaptureIntent", cmdInv.params);
		if (intent == null) {
			params.error = "Internal server error";
		}
		else {
			App.systemAgent.removeIntentGroup (this.name);
			App.systemAgent.runIntent (intent, this.name);
			params.success = true;
		}

		return (this.createCommand ("CommandResult", SystemInterface.Constant.Camera, params));
	}

	// Remove any active timelapse capture intent and return a CommandResult command
	stopCapture (cmdInv) {
		App.systemAgent.removeIntentGroup (this.name);
		return (this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
			success: true
		}));
	}

	// Remove any active timelapse capture intent, delete all stored cache images, and return a CommandResult command
	clearTimelapse (cmdInv) {
		let intent, doClear;

		doClear = () => {
			Log.debug (`${this.toString ()} clear cache directory by command; path=${this.cacheDataPath}`);
			this.clearCacheMetadata ();

			FsUtil.removeDirectory (this.cacheDataPath, (err) => {
				if (err != null) {
					Log.err (`${this.toString ()} failed to clear cache directory; path=${this.cacheDataPath} err=${err}`);
					return;
				}

				FsUtil.createDirectory (this.cacheDataPath, (err) => {
					if (err != null) {
						Log.err (`${this.toString ()} failed to create cache directory; path=${this.cacheDataPath} err=${err}`);
						return;
					}

					this.getDiskSpaceTask.setNextRepeat (0);
				});
			});
		};

		this.clearCacheMetadata ();
		intent = this.getTimelapseCaptureIntent ();
		if (intent != null) {
			App.systemAgent.removeIntentGroup (this.name);
			intent.onCaptureIdle (doClear);
		}
		else {
			doClear ();
		}

		return (this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
			success: true
		}));
	}

	// Handle a request with a GetCaptureImage command
	getCaptureImage (cmdInv, request, response) {
		let path, writeImageFile;

		writeImageFile = (path) => {
			Fs.stat (path, (err, stats) => {
				let stream, isopen;

				if (err != null) {
					Log.err (`${this.toString ()} error reading capture image file; path=${path} err=${err}`);
					response.statusCode = 404;
					response.end ();
					return;
				}

				if (! stats.isFile ()) {
					Log.err (`${this.toString ()} error reading capture image file; path=${path} err=Not a regular file`);
					response.statusCode = 404;
					response.end ();
					return;
				}

				isopen = false;
				stream = Fs.createReadStream (path, { });
				stream.on ("error", (err) => {
					Log.err (`${this.toString ()} error reading capture image file; path=${path} err=${err}`);
					if (! isopen) {
						response.statusCode = 500;
						response.end ();
					}
				});

				stream.on ("open", () => {
					if (isopen) {
						return;
					}

					isopen = true;
					response.statusCode = 200;
					response.setHeader ("Content-Type", "image/jpeg");
					response.setHeader ("Content-Length", stats.size);
					stream.pipe (response);
					stream.on ("finish", () => {
						response.end ();
					});

					response.socket.setMaxListeners (0);
					response.socket.once ("error", (err) => {
						stream.close ();
					});
				});
			});
		};

		path = "";
		if (cmdInv.params.imageTime <= 0) {
			path = this.lastCaptureFile;
			if (path == "") {
				response.statusCode = 404;
				response.end ();
			}
			else {
				writeImageFile (path);
			}
			return;
		}

		TimelapseCaptureIntent.getCaptureImagePath (cmdInv, this).then ((path) => {
			if (path == "") {
				response.statusCode = 404;
				response.end ();
			}
			else {
				writeImageFile (path);
			}
		}).catch ((err) => {
			Log.err (`${this.toString ()} Failed to get capture image; err=${err}`);
			response.statusCode = 500;
			response.end ();
		});
	}

	findCaptureImages (client, cmdInv) {
		TimelapseCaptureIntent.findCaptureImages (cmdInv, this).then ((resultObject) => {
			client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("FindCaptureImagesResult", SystemInterface.Constant.Camera, resultObject));
		}).catch ((err) => {
			Log.err (`${this.toString ()} Failed to find capture images; err=${err}`);
		});
	}
}

module.exports = CameraServer;
