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
const Path = require ("path");
const Net = require ("net");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const FsUtil = require (Path.join (App.SOURCE_DIRECTORY, "FsUtil"));
const RepeatTask = require (Path.join (App.SOURCE_DIRECTORY, "RepeatTask"));
const Intent = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "Intent"));
const Task = require (Path.join (App.SOURCE_DIRECTORY, "Task", "Task"));
const TimelapseCaptureIntent = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "types", "TimelapseCaptureIntent"));
const ServerBase = require (Path.join (App.SOURCE_DIRECTORY, "Server", "ServerBase"));

const RaspividProcessName = "/usr/bin/raspivid";
const KillallProcessName = "/usr/bin/killall";
const GetDiskSpacePeriod = 7 * 60 * 1000; // milliseconds

class CameraServer extends ServerBase {
	constructor () {
		super ();
		this.name = "CameraServer";
		this.description = "Accept and execute commands to control a camera device";

		this.configureParams = [ ];

		this.isReady = false;
		this.totalStorage = 0; // bytes
		this.freeStorage = 0; // bytes
		this.usedStorage = 0; // bytes
		this.getDiskSpaceTask = new RepeatTask ();
		this.cacheDataPath = Path.join (App.DATA_DIRECTORY, App.CameraCachePath);
		this.captureImagePath = "/cam/a.jpg";
		this.isCapturingVideo = false;
		this.videoMonitor = "";

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

	// Start the server's operation and invoke startCallback (err) when complete
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
			}, GetDiskSpacePeriod);

			App.systemAgent.addInvokeRequestHandler (SystemInterface.Constant.DefaultInvokePath, SystemInterface.Constant.Camera, (cmdInv, request, response) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.ConfigureCamera: {
						this.configureCamera (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.CreateTimelapseCaptureIntent: {
						this.createTimelapseCaptureIntent (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.StopCapture: {
						this.stopCapture (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.ClearTimelapse: {
						this.clearTimelapse (cmdInv, request, response);
						break;
					}
					case SystemInterface.CommandId.GetCameraStream: {
						this.getCameraStream (cmdInv, request, response);
						break;
					}
					default: {
						App.systemAgent.writeResponse (request, response, 400);
						break;
					}
				}
			});

			this.captureImagePath = `/cam/${App.systemAgent.getRandomString (App.systemAgent.getRandomInteger (32, 48))}.jpg`;
			Log.debug (`Camera capture image path set: ${this.captureImagePath}`);
			App.systemAgent.addSecondaryRequestHandler (this.captureImagePath, (cmdInv, request, response) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.GetCaptureImage: {
						this.getCaptureImage (cmdInv, request, response);
						break;
					}
					default: {
						App.systemAgent.writeResponse (request, response, 400);
						break;
					}
				}
			});

			App.systemAgent.addLinkCommandHandler (SystemInterface.Constant.Camera, (cmdInv, client) => {
				switch (cmdInv.command) {
					case SystemInterface.CommandId.FindCaptureImages: {
						this.findCaptureImages (cmdInv, client);
						break;
					}
				}
			});

			this.isReady = true;
			App.systemAgent.getApplicationNews ();
			startCallback ();
		}).catch ((err) => {
			startCallback (err);
		});
	}

	// Execute subclass-specific stop operations and invoke stopCallback when complete
	doStop (stopCallback) {
		this.getDiskSpaceTask.stop ();
		App.systemAgent.runProcess (KillallProcessName, [
			"-q", "raspivid"
		]).catch ((err) => {
			Log.err (`${this.toString ()} error stopping raspivid process; err=${err}`);
		}).then (() => {
			stopCallback ();
		});
	}

	// Return a command containing the server's status
	doGetStatus () {
		const params = {
			isReady: this.isReady,
			freeStorage: this.freeStorage,
			totalStorage: this.totalStorage,
			captureImagePath: this.captureImagePath,
			minCaptureTime: this.minCaptureTime,
			lastCaptureTime: this.lastCaptureTime,
			lastCaptureWidth: this.lastCaptureWidth,
			lastCaptureHeight: this.lastCaptureHeight,
			isCapturing: false,
			capturePeriod: 0
		};

		if (this.getTimelapseCaptureIntent () != null) {
			params.isCapturing = true;
			params.capturePeriod = this.getCameraConfigurationValue ("capturePeriod", 0);
		}
		params.imageProfile = this.getCameraConfigurationValue ("imageProfile", 0);
		params.flip = this.getCameraConfigurationValue ("flip", 0);
		if (this.videoMonitor.length > 0) {
			params.videoMonitor = this.videoMonitor;
		}

		return (this.createCommand ("CameraServerStatus", SystemInterface.Constant.Camera, params));
	}

	// Return the active TimelapseCaptureIntent object, or null if no such object was found
	getTimelapseCaptureIntent () {
		const intents = App.systemAgent.findIntents (this.name, true);
		if (intents.length <= 0) {
			return (null);
		}

		return (intents[0]);
	}

	// Return the named value from App.systemAgent.runState.cameraConfiguration, or defaultValue if no such value was found
	getCameraConfigurationValue (key, defaultValue) {
		if ((App.systemAgent.runState.cameraConfiguration == null) || (App.systemAgent.runState.cameraConfiguration[key] === undefined)) {
			return (defaultValue);
		}
		return (App.systemAgent.runState.cameraConfiguration[key]);
	}

	// Configure camera operations and start or stop a TimelapseCaptureIntent if needed
	configureCamera (cmdInv, request, response) {
		App.systemAgent.updateRunState ({
			cameraConfiguration: cmdInv.params
		});

		const params = {
			success: false,
			error: ""
		};
		if (cmdInv.params.isCaptureEnabled) {
			const intent = Intent.createIntent ("TimelapseCaptureIntent", {
				capturePeriod: cmdInv.params.capturePeriod
			});
			if (intent == null) {
				params.error = "Internal server error";
			}
			else {
				App.systemAgent.removeIntentGroup (this.name);
				App.systemAgent.runIntent (intent, this.name);
				params.success = true;
			}
		}
		else {
			App.systemAgent.removeIntentGroup (this.name);
			params.success = true;
		}
		App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, params));
	}

	// Start a new TimelapseCaptureIntent, replacing any existing one
	createTimelapseCaptureIntent (cmdInv, request, response) {
		const params = {
			success: false,
			error: ""
		};
		const intent = Intent.createIntent ("TimelapseCaptureIntent", cmdInv.params);
		if (intent == null) {
			params.error = "Internal server error";
		}
		else {
			App.systemAgent.removeIntentGroup (this.name);
			App.systemAgent.runIntent (intent, this.name);
			params.success = true;
		}

		App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, params));
	}

	// Stop any running capture intent
	stopCapture (cmdInv, request, response) {
		App.systemAgent.removeIntentGroup (this.name);
		App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
			success: true
		}));
	}

	// Stop any running capture intent and delete all stored cache data
	clearTimelapse (cmdInv, request, response) {
		const doClear = () => {
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
		const intent = this.getTimelapseCaptureIntent ();
		if (intent != null) {
			App.systemAgent.removeIntentGroup (this.name);
			intent.onCaptureIdle (doClear);
		}
		else {
			doClear ();
		}

		App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
			success: true
		}));
	}

	// Make live camera video available for playback and respond with a GetCameraStreamResult command
	getCameraStream (cmdInv, request, response) {
		let started;

		if (App.systemAgent.urlHostname.length <= 0) {
			App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
				success: false
			}));
			return;
		}

		const server = new Net.Server ({ });
		server.listen ({
			port: 0
		}, (err) => {
			if (err != null) {
				server.close ();
				Log.err (`${this.toString ()} error starting camera stream; err=${err}`);
				App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
					success: false
				}));
				return;
			}

			const port = server.address ().port;
			server.close ();
			if ((typeof port != "number") || (port <= 0)) {
				Log.err (`${this.toString ()} error starting camera stream; err=Unable to determine listen port, ${port}`);
				App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
					success: false
				}));
				return;
			}

			this.isCapturingVideo = true;
			started = false;
			App.systemAgent.runProcess (KillallProcessName, [
				"-q", "raspivid"
			]).catch ((err) => {
				Log.err (`${this.toString ()} error stopping raspivid process; err=${err}`);
			}).then (() => {
				return (new Promise ((resolve, reject) => {
					const intent = this.getTimelapseCaptureIntent ();
					if (intent == null) {
						resolve ();
						return;
					}
					intent.onCaptureIdle (() => {
						resolve ();
					});
				}));
			}).then (() => {
				const dataCallback = (lines, lineCallback) => {
					if (! started) {
						started = true;
						if (cmdInv.params.monitorName.length > 0) {
							this.videoMonitor = cmdInv.params.monitorName;
						}
						else {
							this.videoMonitor = App.uiText.getText ("DefaultVideoMonitorName");
						}

						App.systemAgent.writeCommandResponse (request, response, this.createCommand ("GetCameraStreamResult", SystemInterface.Constant.Camera, {
							streamUrl: `tcp:${App.DoubleSlash}${App.systemAgent.urlHostname}:${port}`
						}));
					}
					process.nextTick (lineCallback);
				};

				const args = [
					"-n",
					"-v",
					"-t", "0",
					"-l",
					"-o", `tcp:${App.DoubleSlash}0.0.0.0:${port}`
				];
				const flip = this.getCameraConfigurationValue ("flip", SystemInterface.Constant.NoFlip);
				switch (flip) {
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

				const streamprofile = this.getCameraConfigurationValue ("streamProfile", SystemInterface.Constant.DefaultStreamProfile);
				switch (streamprofile) {
					case SystemInterface.Constant.LowQualityStreamProfile: {
						args.push ("-w", "1280");
						args.push ("-h", "720");
						break;
					}
					case SystemInterface.Constant.LowestQualityStreamProfile: {
						args.push ("-w", "640");
						args.push ("-h", "480");
						break;
					}
				}

				return (App.systemAgent.runProcess (RaspividProcessName, args, { }, "", dataCallback));
			}).then ((isExitSuccess) => {
				Log.debug (`${this.toString ()} raspivid process exit; isExitSuccess=${isExitSuccess}`);
				this.videoMonitor = "";
				this.isCapturingVideo = false;
				if (! started) {
					App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
						success: false
					}));
				}
			}).catch ((err) => {
				Log.err (`${this.toString ()} error starting camera stream; err=${err}`);
				this.videoMonitor = "";
				this.isCapturingVideo = false;
				App.systemAgent.writeCommandResponse (request, response, this.createCommand ("CommandResult", SystemInterface.Constant.Camera, {
					success: false
				}));
			});
		});
	}

	// Provide a requested image from cached data
	getCaptureImage (cmdInv, request, response) {
		if (cmdInv.params.imageTime <= 0) {
			if (this.lastCaptureFile == "") {
				App.systemAgent.writeResponse (request, response, 404);
			}
			else {
				App.systemAgent.writeFileResponse (request, response, this.lastCaptureFile, "image/jpeg");
			}
			return;
		}

		TimelapseCaptureIntent.getCaptureImagePath (cmdInv, this).then ((path) => {
			if (path == "") {
				App.systemAgent.writeResponse (request, response, 404);
			}
			else {
				App.systemAgent.writeFileResponse (request, response, path, "image/jpeg");
			}
		}).catch ((err) => {
			Log.err (`${this.toString ()} Failed to get capture image; err=${err}`);
			App.systemAgent.writeResponse (request, response, 500);
		});
	}

	// Find cached images in a specified range
	findCaptureImages (cmdInv, client) {
		TimelapseCaptureIntent.findCaptureImages (cmdInv, this).then ((resultObject) => {
			client.emit (SystemInterface.Constant.WebSocketEvent, this.createCommand ("FindCaptureImagesResult", SystemInterface.Constant.Camera, resultObject));
		}).catch ((err) => {
			Log.err (`${this.toString ()} Failed to find capture images; err=${err}`);
		});
	}
}
module.exports = CameraServer;
