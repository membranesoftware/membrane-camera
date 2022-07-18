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
const Fs = require ("fs");
const Path = require ("path");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));
const FsUtil = require (Path.join (App.SOURCE_DIRECTORY, "FsUtil"));
const OsUtil = require (Path.join (App.SOURCE_DIRECTORY, "OsUtil"));
const SystemInterface = require (Path.join (App.SOURCE_DIRECTORY, "SystemInterface"));
const ExecProcess = require (Path.join (App.SOURCE_DIRECTORY, "ExecProcess"));
const ExecuteTask = require (Path.join (App.SOURCE_DIRECTORY, "Task", "ExecuteTask"));
const GetDiskSpaceTask = require (Path.join (App.SOURCE_DIRECTORY, "Task", "GetDiskSpaceTask"));
const IntentBase = require (Path.join (App.SOURCE_DIRECTORY, "Intent", "IntentBase"));

const RaspistillProcessName = "/usr/bin/raspistill";
const LibcamerastillProcessName = "/usr/bin/libcamera-still";
const SyncProcessName = "/bin/sync";
const RebootProcessName = "reboot";
const MaxImageWidth = 3280;
const MaxImageHeight = 2464;
const MaxCaptureDirectoryCount = 4096;
const PruneTriggerPercent = 98; // Percent of total storage space used
const PruneTargetPercent = 96; // Percent of total storage space used
const CaptureKillTimeout = 128000; // ms
const KillRebootThreshold = 2;

// Stage names
const Initializing = "initializing";
const Initializing2 = "initializing2";
const Initializing3 = "initializing3";
const Resting = "resting";
const Resting2 = "resting2";
const CaptureEnd = "captureEnd";

class TimelapseCaptureIntent extends IntentBase {
	constructor () {
		super ();
		this.name = "TimelapseCaptureIntent";
		this.displayName = "Capture timelapse images";
		this.stateType = "TimelapseCaptureIntentState";

		this.server = null;
		this.serverSensor = { };
		this.captureDirectoryTimes = [ ];
		this.lastCaptureFile = "";
		this.lastCaptureTime = 0;
		this.lastCaptureWidth = 0;
		this.lastCaptureHeight = 0;
		this.isCapturing = false;
		this.killTime = 0;
		this.killCount = 0;
		this.capturePath = "";
		this.capturePathCount = 0;
		this.captureProcess = null;
		this.captureProcessName = LibcamerastillProcessName;
		if (OsUtil.isRaspiosBuster) {
			this.captureProcessName = RaspistillProcessName;
		}
	}

	// Configure the intent's state using values in the provided params object
	doConfigure (configParams) {
		this.state.sensor = configParams.sensor;
		this.state.capturePeriod = configParams.capturePeriod;
	}

	// Execute actions appropriate when the intent becomes active
	doStart () {
		this.server = App.systemAgent.getServer ("CameraServer");
		if (this.server == null) {
			Log.err (`${this.toString ()} CameraServer not found, image capture will not execute`);
		}

		if (typeof this.state.sensor != "number") {
			this.state.sensor = 0;
		}
		if (typeof this.state.capturePeriod != "number") {
			this.state.capturePeriod = 300;
		}
		if (typeof this.state.nextCaptureTime != "number") {
			this.state.nextCaptureTime = 0;
		}

		const max = Date.now () + (this.state.capturePeriod * 1000);
		if (this.state.nextCaptureTime > max) {
			this.state.nextCaptureTime = max;
		}

		this.dataPath = Path.join (App.DATA_DIRECTORY, App.CameraCachePath, `${this.state.sensor}`);

		if (this.server != null) {
			this.serverSensor = this.server.sensors[`${this.state.sensor}`];
			this.serverSensor.isCapturing = true;
			this.serverSensor.capturePeriod = this.state.capturePeriod;
		}
	}

	doStop () {
		if (this.captureProcess != null) {
			this.captureProcess.stop ();
			this.captureProcess = null;
		}
		if (this.server != null) {
			this.serverSensor.isCapturing = false;
			this.serverSensor.capturePeriod = 0;
		}
	}

	// Execute actions appropriate for the current state of the application
	doUpdate () {
		if (this.stage == "") {
			this.setStage (Initializing);
		}
		if (this.isCapturing && (this.captureProcess != null) && (this.killTime > 0) && (this.updateTime >= this.killTime)) {
			++(this.killCount);
			this.killTime = 0;
			this.captureProcess.stop ();
			this.captureProcess = null;
		}
	}

	// Stage methods
	initializing () {
		this.stageAwait (FsUtil.createDirectory (this.dataPath), Initializing2);
	}

	initializing2 () {
		if (this.stagePromiseError != null) {
			Log.err (`${this.toString ()} failed to create directory; dataPath=${this.dataPath} err=${this.stagePromiseError}`);
			this.stageAwait (this.timeoutWait (180000), Initializing);
			return;
		}
		this.stageAwait (TimelapseCaptureIntent.readCacheSummary (this.dataPath), Initializing3);
  }

	initializing3 () {
		const result = this.stagePromiseResult;
		if (result == null) {
			if (this.stagePromiseError != null) {
				Log.err (`${this.toString ()} failed to scan directory; dataPath=${this.dataPath} err=${this.stagePromiseError}`);
			}
			this.stageAwait (this.timeoutWait (180000), Initializing);
			return;
		}
		this.captureDirectoryTimes = result.captureDirectoryTimes;
		this.capturePath = result.capturePath;
		this.capturePathCount = result.capturePathCount;
		this.lastCaptureFile = result.lastCaptureFile;
		this.lastCaptureTime = result.lastCaptureTime;
		this.lastCaptureWidth = result.lastCaptureWidth;
		this.lastCaptureHeight = result.lastCaptureHeight;
		this.setStage (Resting);
	}

	resting () {
		if (this.server == null) {
			return;
		}
		if (this.updateTime < this.state.nextCaptureTime) {
			return;
		}
		if (this.server.cameraTaskGroup.runCount > 0) {
			this.stageAwait (this.server.cameraTaskGroup.awaitIdle (), Resting2);
			return;
		}
		this.state.nextCaptureTime = this.updateTime + (this.state.capturePeriod * 1000);
		this.isCapturing = true;
		this.stageAwait (this.captureImage (), CaptureEnd);
	}

	resting2 () {
		this.setStage (Resting);
	}

	captureEnd () {
		this.isCapturing = false;
		if (this.stagePromiseError != null) {
			Log.debug (`${this.toString ()} failed to capture image; capturePath=${this.capturePath} err=${this.stagePromiseError}`);
			if (this.killCount >= KillRebootThreshold) {
				this.killCount = 0;
				Log.info (`${this.toString ()} reboot system for failure of camera system`);
				App.systemAgent.runProcess (RebootProcessName).catch ((err) => {
					Log.err (`${this.toString ()} error running reboot process; err=${err}`);
				})
			}
			return;
		}
		this.server.getDiskSpaceTask.setNextRepeat (0);
		this.stageAwait (this.pruneCacheFiles (), Resting);
	}

	// Execute operations to capture and store a camera image
	async captureImage () {
		let imagewidth, imageheight;

		if ((this.capturePath == "") || (this.capturePathCount >= MaxCaptureDirectoryCount)) {
			const now = Date.now ();
			this.capturePath = Path.join (this.dataPath, `${now}`);
			this.captureDirectoryTimes.push (now);
			this.capturePathCount = 0;
		}
		await FsUtil.createDirectory (this.capturePath);
		const args = [ ];
		const raspistill = (this.captureProcessName == RaspistillProcessName);
		if (raspistill) {
			args.push ("-t", "1");
			args.push ("-e", "jpg");
			args.push ("-q", "97");
		}
		args.push (raspistill ? "-cs" : "--camera", `${this.state.sensor}`);

		const imageprofile = this.server.getCameraConfigurationValue (this.state.sensor, "imageProfile", SystemInterface.Constant.DefaultImageProfile);
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
		args.push (raspistill ? "-w" : "--width", imagewidth);
		args.push (raspistill ? "-h" : "--height", imageheight);

		const flip = this.server.getCameraConfigurationValue (this.state.sensor, "flip", SystemInterface.Constant.NoFlip);
		switch (flip) {
			case SystemInterface.Constant.HorizontalFlip: {
				args.push (raspistill ? "-hf" : "--hflip");
				break;
			}
			case SystemInterface.Constant.VerticalFlip: {
				args.push (raspistill ? "-vf" : "--vflip");
				break;
			}
			case SystemInterface.Constant.HorizontalAndVerticalFlip: {
				args.push (raspistill ? "-hf" : "--hflip");
				args.push (raspistill ? "-vf" : "--vflip");
				break;
			}
		}

		const imagetime = Date.now ();
		const imagepath = Path.join (this.capturePath, `${imagetime}_${imagewidth}x${imageheight}.jpg`);
		args.push ("-o", imagepath);
		if (this.server.isCaptureRebootEnabled) {
			this.killTime = imagetime + CaptureKillTimeout;
		}

		const task = new ExecuteTask ({
			run: async () => {
				const proc = new ExecProcess (this.captureProcessName, args);
				proc.workingPath = this.dataPath;
				this.captureProcess = proc;
				const isExitSuccess = await proc.awaitEnd ();
				if (this.captureProcess == proc) {
					this.captureProcess = null;
				}
				if (! isExitSuccess) {
					throw Error ("Capture process failed");
				}
			}
		});
		await this.server.cameraTaskGroup.awaitRun (task);
		this.killTime = 0;
		if (! task.isSuccess) {
			throw Error ("Image capture process ended with non-success result");
		}
		this.killCount = 0;
		const exists = await FsUtil.fileExists (imagepath);
		if (! exists) {
			throw Error ("Image capture process failed to create output file");
		}

		this.lastCaptureFile = imagepath;
		this.lastCaptureTime = imagetime;
		this.lastCaptureWidth = imagewidth;
		this.lastCaptureHeight = imageheight;
		++(this.capturePathCount);
		this.serverSensor.captureDirectoryTimes = this.captureDirectoryTimes;
		this.serverSensor.lastCaptureFile = this.lastCaptureFile;
		this.serverSensor.lastCaptureTime = this.lastCaptureTime;
		this.serverSensor.lastCaptureWidth = this.lastCaptureWidth;
		this.serverSensor.lastCaptureHeight = this.lastCaptureHeight;
		if (this.serverSensor.minCaptureTime <= 0) {
			this.serverSensor.minCaptureTime = this.serverSensor.lastCaptureTime;
		}
	}

	// Remove the oldest files from the cache as needed to maintain the configured percentage of free storage space
	async pruneCacheFiles () {
		let bytes, dirfiles, mintime;

		if ((this.server.totalStorage <= 0) || (this.captureDirectoryTimes.length <= 0)) {
			return;
		}
		const task = await App.systemAgent.runBackgroundTask (new GetDiskSpaceTask ({
			targetPath: this.dataPath
		}));
		if (! task.isSuccess) {
			return;
		}
		const df = task.resultObject;
		if (df.total <= 0) {
			return;
		}
		const pct = ((df.total - df.free) / df.total) * 100;
		if (pct < PruneTriggerPercent) {
			return;
		}
		bytes = df.free;
		const targetbytes = Math.floor ((df.total * (100 - PruneTargetPercent)) / 100);
		const imagefiles = [ ];
		const targetfiles = [ ];
		const dirname = `${this.captureDirectoryTimes[0]}`;
		const dirpath = Path.join (this.dataPath, dirname);
		dirfiles = await FsUtil.readDirectory (dirpath);
		for (const file of dirfiles) {
			const f = TimelapseCaptureIntent.parseImageFilename (file);
			if (f != null) {
				imagefiles.push (f);
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
		while (imagefiles.length > 0) {
			if (bytes >= targetbytes) {
				break;
			}
			const f = imagefiles.shift ();
			const file = Path.join (dirpath, f.filename);
			const stats = await FsUtil.statFile (file);
			targetfiles.push (file);
			bytes += stats.size;
		}

		if (targetfiles.length <= 0) {
			return;
		}
		for (const file of targetfiles) {
			await new Promise ((resolve, reject) => {
				Fs.unlink (file, (err) => {
					if (err) {
						reject (err);
						return;
					}
					resolve ();
				});
			});
		}
		await App.systemAgent.runProcess (SyncProcessName);

		if (imagefiles.length <= 0) {
			const pos = this.captureDirectoryTimes.indexOf (+dirname);
			if (pos >= 0) {
				this.captureDirectoryTimes.splice (pos, 1);
				this.serverSensor.captureDirectoryTimes = this.captureDirectoryTimes;
			}
			await FsUtil.removeDirectory (dirpath);

			if (this.captureDirectoryTimes.length <= 0) {
				this.server.clearCacheMetadata (this.state.sensor);
			}
			else {
				mintime = 0;
				dirfiles = await FsUtil.readDirectory (Path.join (this.dataPath, `${this.captureDirectoryTimes[0]}`));
				for (const file of dirfiles) {
					const f = TimelapseCaptureIntent.parseImageFilename (file);
					if ((f != null) && (f.time > 0)) {
						if ((mintime <= 0) || (f.time < mintime)) {
							mintime = f.time;
						}
					}
				}
				this.serverSensor.minCaptureTime = mintime;
			}
		}
		else {
			this.serverSensor.minCaptureTime = imagefiles[0].time;
		}
	}
}

// Parse the provided capture image filename and return an object with the resulting fields, or null if the parse failed
TimelapseCaptureIntent.parseImageFilename = (filename) => {
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
		filename: filename,
		time: t,
		width: w,
		height: h
	});
};

// Read summary metadata from files in the specified cache path
TimelapseCaptureIntent.readCacheSummary = async (cachePath) => {
	let files;

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
	files = await FsUtil.readDirectory (cachePath);
	for (const file of files) {
		if (file.match (/^[0-9]+$/)) {
			const stats = await FsUtil.statFile (Path.join (cachePath, file));
			if ((stats != null) && stats.isDirectory ()) {
				result.captureDirectoryTimes.push (+file);
			}
		}
	}
	if (result.captureDirectoryTimes.length > 0) {
		result.captureDirectoryTimes.sort ((a, b) => {
			if (isNaN (a) || isNaN (b) || (a == b)) {
				return (0);
			}
			if (a < b) {
				return (-1);
			}
			return (1);
		});

		files = await FsUtil.readDirectory (Path.join (cachePath, `${result.captureDirectoryTimes[0]}`));
		for (const file of files) {
			const f = TimelapseCaptureIntent.parseImageFilename (file);
			if ((f != null) && (f.time > 0)) {
				if ((result.minCaptureTime <= 0) || (f.time < result.minCaptureTime)) {
					result.minCaptureTime = f.time;
				}
			}
		}

		result.capturePath = Path.join (cachePath, `${result.captureDirectoryTimes[result.captureDirectoryTimes.length - 1]}`);
		files = await FsUtil.readDirectory (result.capturePath);
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
	}
	return (result);
};

// Find cache images in the range specified by the provided FindCaptureImages command, returning a FindCaptureImagesResult object if successful
TimelapseCaptureIntent.findCaptureImages = async (cmdInv, cameraServer) => {
	let mintime, maxtime, i, sortCompare, files;

	const result = {
		captureTimes: [ ]
	};
	const sensor = cameraServer.sensors[`${cmdInv.params.sensor}`];
	if ((sensor == null) || (! Array.isArray (sensor.captureDirectoryTimes)) || (sensor.captureDirectoryTimes.length <= 0)) {
		return (result);
	}
	mintime = cmdInv.params.minTime;
	if (mintime <= 0) {
		mintime = sensor.minCaptureTime;
	}
	maxtime = cmdInv.params.maxTime;
	if (maxtime <= 0) {
		maxtime = sensor.lastCaptureTime;
	}

	const dirpaths = [ ];
	if (cmdInv.params.isDescending) {
		i = sensor.captureDirectoryTimes.length - 1;
		while (i > 0) {
			if (sensor.captureDirectoryTimes[i] <= maxtime) {
				break;
			}
			--i;
		}
		while (i >= 0) {
			dirpaths.push (Path.join (cameraServer.cacheDataPath, `${cmdInv.params.sensor}`, `${sensor.captureDirectoryTimes[i]}`));
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
		while (i < (sensor.captureDirectoryTimes.length - 1)) {
			if (sensor.captureDirectoryTimes[i] <= mintime) {
				break;
			}
			++i;
		}
		while (i < sensor.captureDirectoryTimes.length) {
			dirpaths.push (Path.join (cameraServer.cacheDataPath, `${cmdInv.params.sensor}`, `${sensor.captureDirectoryTimes[i]}`));
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

	const maxresults = cmdInv.params.maxResults;
	for (const path of dirpaths) {
		if ((maxresults > 0) && (result.captureTimes.length >= maxresults)) {
			break;
		}
		try {
			files = await FsUtil.readDirectory (path);
		}
		catch (err) {
			Log.debug (`TimelapseCaptureIntent.findCaptureImages readdir failed; path=${path} err=${err}`);
			continue;
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
				if ((maxresults > 0) && (result.captureTimes.length >= maxresults)) {
					break;
				}
			}
		}
	}
	return (result);
};

// Find the path for the cache image specified by the provided GetCaptureImage command, returning a non-empty path value if successful or an empty path value for a file not found result
TimelapseCaptureIntent.getCaptureImagePath = async (cmdInv, cameraServer) => {
	let dirtime, result;

	const sensor = cameraServer.sensors[`${cmdInv.params.sensor}`];
	if ((sensor == null) || (! Array.isArray (sensor.captureDirectoryTimes)) || (sensor.captureDirectoryTimes.length <= 0)) {
		return ("");
	}
	dirtime = 0;
	for (const t of sensor.captureDirectoryTimes) {
		if (t > cmdInv.params.imageTime) {
			break;
		}
		dirtime = t;
	}
	if (dirtime <= 0) {
		return ("");
	}

	const dirpath = Path.join (cameraServer.cacheDataPath, `${cmdInv.params.sensor}`, `${dirtime}`);
	const files = await FsUtil.readDirectory (dirpath);
	result = "";
	for (const file of files) {
		if (file.indexOf (`${cmdInv.params.imageTime}`) === 0) {
			result = Path.join (dirpath, file);
			break;
		}
	}
	return (result);
};
module.exports = TimelapseCaptureIntent;
