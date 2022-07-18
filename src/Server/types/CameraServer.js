/*
* Copyright 2019-2022 Membrane Software <author@membranesoftware.com> https://membranesoftware.com
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
const OsUtil = require (Path.join (App.SOURCE_DIRECTORY, "OsUtil"));
const FfmpegUtil = require (Path.join (App.SOURCE_DIRECTORY, "FfmpegUtil"));
const RepeatTask = require (Path.join (App.SOURCE_DIRECTORY, "RepeatTask"));
const ExecProcess = require (Path.join (App.SOURCE_DIRECTORY, "ExecProcess"));
const Intent = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "Intent"));
const TaskGroup = require (Path.join (App.SOURCE_DIRECTORY, "Task", "TaskGroup"));
const Task = require (Path.join (App.SOURCE_DIRECTORY, "Task", "Task"));
const ExecuteTask = require (Path.join (App.SOURCE_DIRECTORY, "Task", "ExecuteTask"));
const GetDiskSpaceTask = require (Path.join (App.SOURCE_DIRECTORY, "Task", "GetDiskSpaceTask"));
const TimelapseCaptureIntent = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "types", "TimelapseCaptureIntent"));
const ServerBase = require (Path.join (App.SOURCE_DIRECTORY, "Server", "ServerBase"));

const RaspividProcessName = "/usr/bin/raspivid";
const LibcameravidProcessName = "/usr/bin/libcamera-vid";
const GetDiskSpacePeriod = 7 * 60 * 1000; // milliseconds
const GetCameraStreamPlayTimeout = 12000; // milliseconds

const GetCaptureVideoPath = "capture-video";
class GetCaptureVideoTask extends Task {
	constructor (configureMap) {
		super (configureMap);
		this.dataPath = Path.join (App.DATA_DIRECTORY, GetCaptureVideoPath);
	}

	async run () {
		let count, targetpath, started;

		const server = this.configureMap.server;
		const request = this.configureMap.request;
		const response = this.configureMap.response;
		const cmdInv = this.configureMap.cmdInv;
		if ((server == null) || (request == null) || (response == null) || (cmdInv == null)) {
			throw Error ("Missing task configuration objects");
		}
		const result = await TimelapseCaptureIntent.findCaptureImages (App.systemAgent.createCommand (SystemInterface.CommandId.FindCaptureImages, {
			sensor: cmdInv.params.sensor,
			minTime: cmdInv.params.minTime,
			maxTime: cmdInv.params.maxTime,
			isDescending: cmdInv.params.isDescending,
			maxResults: 0
		}), server);
		if (result.captureTimes.length <= 0) {
			throw Error ("No capture images found");
		}

		await FsUtil.removeDirectory (this.dataPath);
		await FsUtil.createDirectory (this.dataPath);
		count = 0;
		const numlen = `${result.captureTimes.length}`.length;
		for (const t of result.captureTimes) {
			const filepath = await TimelapseCaptureIntent.getCaptureImagePath (App.systemAgent.createCommand (SystemInterface.CommandId.GetCaptureImage, {
				sensor: cmdInv.params.sensor,
				imageTime: t
			}), server);
			if (filepath == "") {
				continue;
			}
			targetpath = `${count}`;
			while (targetpath.length < numlen) {
				targetpath = `0${targetpath}`;
			}
			targetpath = `${targetpath}.jpg`;
			await FsUtil.createLink (filepath, Path.join (this.dataPath, targetpath));
			++count;
		}

		started = false;
		const args = [
			"-f", "image2",
			"-r", "2",
			"-i", `%0${numlen}d.jpg`,
			"-vcodec", "libx264",
			"-preset", "medium",
			"-f", "mpeg",
			"-"
		];
		const proc = FfmpegUtil.createFfmpegProcess (args, this.dataPath);
		proc.onReadStdout ((data) => {
			if (! started) {
				started = true;
				const filename = cmdInv.params.isDescending ? `${cmdInv.params.maxTime}_${cmdInv.params.minTime}.mpeg` : `${cmdInv.params.minTime}_${cmdInv.params.maxTime}.mpeg`;
				Log.debug2 (`HTTP 200; client=${request.socket.remoteAddress}:${request.socket.remotePort} method=${request.method} url=${request.url}`);
				response.statusCode = 200;
				response.setHeader ("Content-Type", "video/mpeg");
				response.setHeader ("Content-Disposition", `attachment; filename="${filename}"`);
			}
			response.write (data);
		});
		await proc.awaitEnd ();
		response.end ();
		this.isSuccess = true;
	}

	async end () {
		await FsUtil.removeDirectory (this.dataPath);
	}
}

class CameraServer extends ServerBase {
	constructor () {
		super ();
		this.setName ("CameraServer");
		this.description = "Accept and execute commands to control a camera device";

		this.configureParams = [
			{
				name: "captureReboot",
				type: "boolean",
				flags: 0,
				description: "A boolean value indicating if the server should reboot its host system to recover from capture failures"
			}
		];

		this.lastStatus = null;
		this.isReady = false;
		this.isCaptureRebootEnabled = false;
		this.totalStorage = 0; // bytes
		this.freeStorage = 0; // bytes
		this.usedStorage = 0; // bytes
		this.getDiskSpaceTask = new RepeatTask ();
		this.getDiskSpaceTask.setAsync ((err) => {
			Log.debug (`${this.name} failed to get free disk space; err=${err}`);
		});
		this.cameraTaskGroup = new TaskGroup ();
		this.cameraTaskGroup.maxRunCount = 1;
		this.getCaptureVideoTaskGroup = new TaskGroup ();
		this.getCaptureVideoTaskGroup.maxRunCount = 1;

		this.cacheDataPath = Path.join (App.DATA_DIRECTORY, App.CameraCachePath);
		this.captureImagePath = "/cam/a.jpg";
		this.captureVideoPath = "/cam/b.mpeg";

		this.sensors = {
			"0": {
				isCapturing: false,
				videoMonitor: "",
				capturePeriod: 0,
				imageProfile: 0,
				flip: 0,
				minCaptureTime: 0,
				lastCaptureTime: 0,
				lastCaptureWidth: 0,
				lastCaptureHeight: 0,
				dataPath: Path.join (this.cacheDataPath, "0"),
				captureProcess: null,
				captureDirectoryTimes: [ ],
				lastCaptureFile: ""
			}
		};

		this.captureVideoProcess = null;
		this.captureVideoProcessName = LibcameravidProcessName;
		if (OsUtil.isRaspiosBuster) {
			this.captureVideoProcessName = RaspividProcessName;
		}

		this.clearCacheMetadata ();
	}

	// Reset stored cache metadata fields to empty values. If sensorId is provided, target only that sensor's state.
	clearCacheMetadata (sensorId) {
		const clear = (sensor) => {
			if (sensor == null) {
				return;
			}
			sensor.captureDirectoryTimes = [ ];
			sensor.minCaptureTime = 0;
			sensor.lastCaptureFile = "";
			sensor.lastCaptureTime = 0;
			sensor.lastCaptureWidth = 0;
			sensor.lastCaptureHeight = 0;
		};
		if (sensorId !== undefined) {
			clear (this.sensors[`${sensorId}`]);
			return;
		}
		for (const sensor of Object.values (this.sensors)) {
			clear (sensor);
		}
	}

	// Execute actions appropriate when the server has been successfully configured
	doConfigure () {
		if (this.configureMap.captureReboot === true) {
			this.isCaptureRebootEnabled = true;
		}
	}

	// Change subclass-specific fields in the provided server configuration object
	doGetConfiguration (fields) {
		delete (fields.captureReboot);
	}

	// Start the server's operation
	async doStart () {
		this.cameraTaskGroup.start ();
		this.getCaptureVideoTaskGroup.start ();
		await FsUtil.createDirectory (this.cacheDataPath);
		for (const sensorid in this.sensors) {
			const sensor = this.sensors[sensorid];
			sensor.imageProfile = this.getCameraConfigurationValue (sensorid, "imageProfile", SystemInterface.Constant.DefaultImageProfile);
			sensor.flip = this.getCameraConfigurationValue (sensorid, "flip", SystemInterface.Constant.NoFlip);

			await FsUtil.createDirectory (sensor.dataPath);
			const summary = await TimelapseCaptureIntent.readCacheSummary (sensor.dataPath);
			sensor.captureDirectoryTimes = summary.captureDirectoryTimes;
			sensor.minCaptureTime = summary.minCaptureTime;
			sensor.lastCaptureFile = summary.lastCaptureFile;
			sensor.lastCaptureTime = summary.lastCaptureTime;
			sensor.lastCaptureWidth = summary.lastCaptureWidth;
			sensor.lastCaptureHeight = summary.lastCaptureHeight;
		}

		await this.getDiskSpace ();
		this.getDiskSpaceTask.setRepeating (this.getDiskSpace.bind (this), GetDiskSpacePeriod);

		for (const cmdid of [
			SystemInterface.CommandId.ConfigureCamera,
			SystemInterface.CommandId.CreateTimelapseCaptureIntent,
			SystemInterface.CommandId.StopCapture,
			SystemInterface.CommandId.ClearTimelapse,
			SystemInterface.CommandId.GetCameraStream
		]) {
			this.addInvokeRequestHandler (SystemInterface.Constant.DefaultInvokePath, cmdid);
		}

		this.addLinkCommandHandler (SystemInterface.CommandId.FindCaptureImages);

		this.captureImagePath = `/cam/${App.systemAgent.getRandomString (App.systemAgent.getRandomInteger (32, 48))}.jpg`;
		this.addSecondaryInvokeRequestHandler (this.captureImagePath, SystemInterface.CommandId.GetCaptureImage);

		this.captureVideoPath = `/cam/${App.systemAgent.getRandomString (App.systemAgent.getRandomInteger (32, 48))}.mpeg`;
		this.addSecondaryInvokeRequestHandler (this.captureVideoPath, SystemInterface.CommandId.GetCaptureVideo);

		this.isReady = true;
		App.systemAgent.getApplicationNews ();
	}

	// Execute subclass-specific stop operations
	async doStop () {
		if (this.captureVideoProcess) {
			this.captureVideoProcess.stop ();
			this.captureVideoProcess = null;
		}
		this.cameraTaskGroup.stop ();
		this.getCaptureVideoTaskGroup.stop ();
		this.getDiskSpaceTask.stop ();
	}

	// Return a command containing the server's status
	doGetStatus () {
		const params = {
			isReady: this.isReady,
			freeStorage: this.freeStorage,
			totalStorage: this.totalStorage,
			captureImagePath: this.captureImagePath,
			captureVideoPath: this.captureVideoPath,
			sensors: [ ]
		};
		for (const sensor of Object.values (this.sensors)) {
			params.sensors.push ({
				isCapturing: sensor.isCapturing,
				videoMonitor: sensor.videoMonitor,
				capturePeriod: sensor.capturePeriod,
				imageProfile: sensor.imageProfile,
				flip: sensor.flip,
				minCaptureTime: sensor.minCaptureTime,
				lastCaptureTime: sensor.lastCaptureTime,
				lastCaptureWidth: sensor.lastCaptureWidth,
				lastCaptureHeight: sensor.lastCaptureHeight
			});
		}
		return (App.systemAgent.createCommand (SystemInterface.CommandId.CameraServerStatus, params));
	}

	// Return a boolean value indicating if the provided AgentStatus command contains subclass-specific fields indicating a server status change
	doFindStatusChange (agentStatus) {
		let result;

		const fields = agentStatus.params.cameraServerStatus;
		if (fields == null) {
			return (false);
		}
		result = false;
		if (this.lastStatus != null) {
			for (const sensor of fields.sensors) {
				const last = this.lastStatus.sensors.shift ();
				if (! last) {
					break;
				}
				result = (sensor.lastCaptureTime !== last.lastCaptureTime) ||
					(sensor.freeStorage !== last.freeStorage) ||
					(sensor.isCapturing !== last.isCapturing) ||
					(sensor.videoMonitor !== last.videoMonitor) ||
					(sensor.capturePeriod !== last.capturePeriod) ||
					(sensor.imageProfile !== last.imageProfile) ||
					(sensor.flip !== last.flip) ||
					(sensor.minCaptureTime !== last.minCaptureTime);
				if (result) {
					break;
				}
			}
		}
		this.lastStatus = fields;
		return (result);
	}

	// Update free disk space values
	async getDiskSpace () {
		const task = await App.systemAgent.runBackgroundTask (new GetDiskSpaceTask ({
			targetPath: this.cacheDataPath
		}));
		if (task.isSuccess) {
			this.totalStorage = task.resultObject.total;
			this.usedStorage = task.resultObject.used;
			this.freeStorage = task.resultObject.free;
		}
	}

	// Return the named value from App.systemAgent.runState.cameraConfiguration, or defaultValue if no such value was found
	getCameraConfigurationValue (sensor, key, defaultValue) {
		if (App.systemAgent.runState.cameraConfiguration == null) {
			return (defaultValue);
		}
		const config = App.systemAgent.runState.cameraConfiguration[`${sensor}`];
		if ((config == null) || (config[key] === undefined)) {
			return (defaultValue);
		}
		return (config[key]);
	}

	// Configure camera operations and start or stop a TimelapseCaptureIntent if needed
	async configureCamera (cmdInv, request, response) {
		const sensor = this.sensors[`${cmdInv.params.sensor}`];
		if (sensor == null) {
			App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
				success: false
			}));
			return;
		}
		sensor.imageProfile = cmdInv.params.imageProfile;
		sensor.flip = cmdInv.params.flip;

		const config = (App.systemAgent.runState.cameraConfiguration != null) ? App.systemAgent.runState.cameraConfiguration : { };
		config[`${cmdInv.params.sensor}`] = {
			imageProfile: cmdInv.params.imageProfile,
			flip: cmdInv.params.flip
		};
		App.systemAgent.updateRunState ({
			cameraConfiguration: config
		});

		const params = {
			success: false,
			error: ""
		};
		if (cmdInv.params.isCaptureEnabled) {
			const intent = Intent.createIntent ("TimelapseCaptureIntent", {
				sensor: cmdInv.params.sensor,
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
		App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, params));
	}

	// Start a new TimelapseCaptureIntent, replacing any existing one
	async createTimelapseCaptureIntent (cmdInv, request, response) {
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

		App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, params));
	}

	// Stop any running capture intent
	async stopCapture (cmdInv, request, response) {
		App.systemAgent.removeIntentGroup (this.name);
		App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
			success: true
		}));
	}

	// Stop any running capture intent and delete all stored cache data
	async clearTimelapse (cmdInv, request, response) {
		App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
			success: true
		}));

		try {
			this.clearCacheMetadata ();
			App.systemAgent.removeIntentGroup (this.name);
			await this.cameraTaskGroup.awaitIdle ();
			Log.debug (`${this.toString ()} clear cache directory by command; path=${this.cacheDataPath}`);
			await FsUtil.removeDirectory (this.cacheDataPath);
			this.clearCacheMetadata ();
			await FsUtil.createDirectory (this.cacheDataPath);
			for (const sensor of Object.values (this.sensors)) {
				await FsUtil.createDirectory (sensor.dataPath);
			}
			this.getDiskSpaceTask.setNextRepeat (0);
		}
		catch (err) {
			Log.err (`${this.toString ()} failed to clear cache directory; path=${this.cacheDataPath} err=${err}`);
		}
	}

	// Make live camera video available for playback and respond with a GetCameraStreamResult command
	async getCameraStream (cmdInv, request, response) {
		let started, responseclosed, clientplayed;

		const sensor = `${cmdInv.params.sensor}`;
		if ((this.sensors[sensor] == null) || (App.systemAgent.urlHostname.length <= 0)) {
			App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
				success: false
			}));
			return;
		}
		responseclosed = false;
		response.once ("close", () => {
			responseclosed = true;
		});
		const port = await new Promise ((resolve, reject) => {
			const server = new Net.Server ({ });
			server.listen ({
				port: 0
			}, (err) => {
				if (err != null) {
					server.close ();
					reject (err);
					return;
				}
				const port = server.address ().port;
				server.close ();
				if ((typeof port != "number") || (port <= 0)) {
					throw Error (`Unable to determine listen port, result ${port}`);
				}
				resolve (port);
			});
		});
		if (responseclosed) {
			App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
				success: false
			}));
			return;
		}

		started = false;
		clientplayed = false;
		await this.cameraTaskGroup.awaitIdle ();
		if (responseclosed) {
			App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
				success: false
			}));
			return;
		}
		const raspivid = (this.captureVideoProcessName == RaspividProcessName);
		const args = [ ];
		args.push (
			"-n",
			"-v",
			"-t", "0",
			"-l",
			"-o", `tcp:${App.DoubleSlash}0.0.0.0:${port}`,
			"--inline",
			"--flush"
		);
		if (raspivid) {
			args.push ("--spstimings");
		}
		args.push (raspivid ? "-cs" : "--camera", `${cmdInv.params.sensor}`);

		switch (cmdInv.params.flip) {
			case SystemInterface.Constant.HorizontalFlip: {
				args.push (raspivid ? "-hf" : "--hflip");
				break;
			}
			case SystemInterface.Constant.VerticalFlip: {
				args.push (raspivid ? "-vf" : "--vflip");
				break;
			}
			case SystemInterface.Constant.HorizontalAndVerticalFlip: {
				args.push (raspivid ? "-hf" : "--hflip");
				args.push (raspivid ? "-vf" : "--vflip");
				break;
			}
		}
		switch (cmdInv.params.streamProfile) {
			case SystemInterface.Constant.LowQualityCameraStreamProfile: {
				args.push (raspivid ? "-w" : "--width", "1280");
				args.push (raspivid ? "-h" : "--height", "720");
				args.push (raspivid ? "-b" : "--bitrate", `${1024*1024}`);
				break;
			}
			case SystemInterface.Constant.LowestQualityCameraStreamProfile: {
				args.push (raspivid ? "-w" : "--width", "640");
				args.push (raspivid ? "-h" : "--height", "480");
				args.push (raspivid ? "-b" : "--bitrate", `${768*1024}`);
				break;
			}
			default: {
				args.push (raspivid ? "-w" : "--width", "1920");
				args.push (raspivid ? "-h" : "--height", "1080");
				args.push (raspivid ? "-b" : "--bitrate", `${2048*1024}`);
				break;
			}
		}

		const dataCallback = (lines, lineCallback) => {
			if (! started) {
				started = true;
				this.sensors[sensor].videoMonitor = (cmdInv.params.monitorName.length > 0) ? cmdInv.params.monitorName : App.uiText.getText ("DefaultVideoMonitorName");
				App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.GetCameraStreamResult, {
					streamUrl: `tcp/h264:${App.DoubleSlash}${App.systemAgent.urlHostname}:${port}`
				}));
			}
			if (! clientplayed) {
				for (const line of lines) {
					if (line.includes ("Client connection accepted") || line.includes ("Client connected from")) {
						clientplayed = true;
						break;
					}
				}
			}
			process.nextTick (lineCallback);
		};
		const task = new ExecuteTask ({
			run: async () => {
				const proc = new ExecProcess (this.captureVideoProcessName, args);
				proc.onReadLines (dataCallback);
				this.captureVideoProcess = proc;

				setTimeout (() => {
					if (! clientplayed) {
						if (this.captureVideoProcess == proc) {
							this.captureVideoProcess.stop ();
							this.captureVideoProcess = null;
						}
					}
				}, GetCameraStreamPlayTimeout);

				const isExitSuccess = await proc.awaitEnd ();
				if (this.captureVideoProcess == proc) {
					this.captureVideoProcess = null;
				}
				Log.debug (`${this.toString ()} video stream process exit; isExitSuccess=${isExitSuccess}`);
			}
		});
		await this.cameraTaskGroup.awaitRun (task);
		this.sensors[sensor].videoMonitor = "";
		if (! started) {
			App.systemAgent.writeCommandResponse (request, response, App.systemAgent.createCommand (SystemInterface.CommandId.CommandResult, {
				success: false
			}));
		}
	}

	// Provide a requested image from cached data
	async getCaptureImage (cmdInv, request, response) {
		const sensor = `${cmdInv.params.sensor}`;
		if (this.sensors[sensor] == null) {
			App.systemAgent.writeResponse (request, response, 404);
			return;
		}
		if (cmdInv.params.imageTime <= 0) {
			if (this.sensors[sensor].lastCaptureFile == "") {
				App.systemAgent.writeResponse (request, response, 404);
			}
			else {
				App.systemAgent.writeFileResponse (request, response, this.sensors[sensor].lastCaptureFile, "image/jpeg");
			}
			return;
		}

		const path = await TimelapseCaptureIntent.getCaptureImagePath (cmdInv, this);
		if (path == "") {
			App.systemAgent.writeResponse (request, response, 404);
		}
		else {
			App.systemAgent.writeFileResponse (request, response, path, "image/jpeg");
		}
	}

	// Find cached images in a specified range
	async findCaptureImages (cmdInv, client) {
		try {
			const sensor = `${cmdInv.params.sensor}`;
			if (this.sensors[sensor] == null) {
				throw Error (`Unknown sensor ${sensor}`);
			}
			const result = await TimelapseCaptureIntent.findCaptureImages (cmdInv, this);
			const cmd = App.systemAgent.createCommand (SystemInterface.CommandId.FindCaptureImagesResult, result);
			if (cmd == null) {
				throw Error ("Invalid FindCaptureImagesResult fields");
			}
			client.emit (SystemInterface.Constant.WebSocketEvent, cmd);
		}
		catch (err) {
			Log.err (`${this.toString ()} Failed to find capture images; err=${err}`);
		}
	}

	// Provide a requested set of images from cached data, presented as an mpeg video stream
	async getCaptureVideo (cmdInv, request, response) {
		const sensor = `${cmdInv.params.sensor}`;
		if (this.sensors[sensor] == null) {
			App.systemAgent.writeResponse (request, response, 404);
			return;
		}
		const task = await this.getCaptureVideoTaskGroup.awaitRun (new GetCaptureVideoTask ({
			server: this,
			request: request,
			response: response,
			cmdInv: cmdInv
		}));
		if (! task.isSuccess) {
			try {
				App.systemAgent.writeResponse (request, response, 500);
			}
			catch (err) {
				Log.debug4 (`${this.toString ()} getCaptureVideo response failed; err=${err}`);
			}
		}
	}
}
module.exports = CameraServer;
