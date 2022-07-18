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
// Class that runs a child process and emits events as lines of data are generated

"use strict";

const App = global.App || { };
const ChildProcess = require ("child_process");
const Path = require ("path");
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));

class ExecProcess {
	// execPath: the path to the binary to run
	// execArgs: an array containing command line arguments for the child process
	constructor (execPath, execArgs) {
		// Read-write data members
		this.env = { };
		this.workingPath = App.DATA_DIRECTORY;
		this.stopSignalRepeatDelay = 4800; // milliseconds

		// Read-only data members
		this.isSuspended = false;
		this.isEnded = false;
		this.exitCode = -1;
		this.exitSignal = "";
		this.isExitSuccess = false;
		this.isReadPaused = false;
		this.readLinesCallback = null;
		this.enableStdoutReadLines = false;
		this.enableStderrReadLines = false;
		this.readStdoutCallback = () => {};
		this.readStderrCallback = () => {};
		this.endCallback = null;

		this.execPath = execPath;
		if (this.execPath.indexOf ("/") !== 0) {
			this.execPath = Path.join (App.BIN_DIRECTORY, this.execPath);
		}
		this.execArgs = [ ];
		if (Array.isArray (execArgs)) {
			this.execArgs = execArgs;
		}
		this.isEndCallbackExecuted = false;
		this.isWriteEnded = false;
		this.isDrainingStdin = false;
		this.stdinWriteData = "";
		this.process = null;
		setImmediate (() => {
			this.runProcess ();
		});
	}

	// Set the process to invoke callback (err, isExitSuccess) when it ends
	onEnd (callback) {
		if (typeof callback != "function") {
			return;
		}
		this.endCallback = callback;
	}

	// Set the process to invoke callback (lines, parseCallback) each time a set of stdout or stderr lines is parsed. If enableStdoutParse is false, do not generate events for stdout data. If enableStderrParse is false, do not generate events for stderr data.
	onReadLines (callback, enableStdoutParse, enableStderrParse) {
		if (typeof callback != "function") {
			return;
		}
		this.readLinesCallback = callback;
		this.enableStdoutReadLines = (enableStdoutParse !== false);
		this.enableStderrReadLines = (enableStderrParse !== false);
	}

	// Set the process to invoke callback (data) each time stdout reads a data buffer.
	onReadStdout (callback) {
		if (typeof callback != "function") {
			return;
		}
		this.readStdoutCallback = callback;
	}

	// Set the process to invoke callback (data) each time stderr reads a data buffer.
	onReadStderr (callback) {
		if (typeof callback != "function") {
			return;
		}
		this.readStderrCallback = callback;
	}

	// Write the provided data to the process's stdin
	write (data) {
		if (this.isWriteEnded) {
			return;
		}
		const proc = this.process;
		if ((proc == null) || this.isDrainingStdin) {
			this.stdinWriteData += data.toString ();
			return;
		}
		if (! proc.stdin.write (data)) {
			this.isDrainingStdin = true;
			this.stdinWriteData = "";
			proc.stdin.once ("drain", () => {
				const writedata = this.stdinWriteData;
				this.isDrainingStdin = false;
				this.stdinWriteData = "";
				if (writedata.length > 0) {
					this.write (writedata);
				}
			});
		}
	}

	// Signal the end of write data to the process's stdin
	endWrite () {
		this.isWriteEnded = true;
		const proc = this.process;
		if (proc == null) {
			return;
		}
		proc.stdin.end ();
	}

	// Stop the process
	stop () {
		if (this.isEnded) {
			return;
		}
		this.process.kill ("SIGTERM");
		const repeatKill = () => {
			if (this.isEnded) {
				return;
			}
			this.process.kill ("SIGKILL");
		};
		setTimeout (repeatKill, this.stopSignalRepeatDelay);
	}

	// Suspend the process
	suspend () {
		if (this.isEnded || this.isSuspended) {
			return;
		}
		this.isSuspended = true;
		this.process.kill ("SIGSTOP");
	}

	// Unsuspend the process
	unsuspend () {
		if (! this.isSuspended) {
			return;
		}
		this.process.kill ("SIGCONT");
		this.isSuspended = false;
	}

	// Return a promise that clears endCallback and resolves with (isExitSuccess) when the process ends
	async awaitEnd () {
		const result = await new Promise ((resolve, reject) => {
			if (this.isEnded || this.isEndCallbackExecuted) {
				resolve (this.isExitSuccess);
				return;
			}
			this.endCallback = (err, isExitSuccess) => {
				if (err != null) {
					reject (err);
					return;
				}
				resolve (isExitSuccess);
			};
		});
		return (result);
	}

	// Run the configured process
	runProcess () {
		let proc, endcount;

		try {
			proc = ChildProcess.spawn (this.execPath, this.execArgs, {
				cwd: this.workingPath,
				env: this.env
			});
		}
		catch (err) {
			Log.err (`Failed to launch child process; execPath=${this.execPath} execArgs=${JSON.stringify (this.execArgs)} workingPath=${this.workingPath} env=${JSON.stringify (this.env)} err=${err}\n${err.stack}`);
			if ((typeof this.endCallback == "function") && (! this.isEndCallbackExecuted)) {
				this.isEndCallbackExecuted = true;
				setImmediate (() => {
					this.endCallback (err, false);
				});
			}
			return;
		}
		const writedata = this.stdinWriteData;
		const writeended = this.isWriteEnded;
		this.process = proc;
		endcount = 0;
		this.isEnded = false;
		this.isWriteEnded = false;
		this.isDrainingStdin = false;
		this.stdinWriteData = "";
		this.exitCode = -1;
		this.exitSignal = "";
		this.isExitSuccess = false;
		this.stdoutLineBuffer = "";
		this.stderrLineBuffer = "";

		proc.stdout.on ("data", (data) => {
			this.readStdoutCallback (data);
			if (this.enableStdoutReadLines) {
				this.stdoutLineBuffer += data.toString ();
				this.parseLineBuffers ();
			}
		});
		proc.stdout.on ("end", () => {
			++endcount;
			if (endcount >= 3) {
				endRun ();
			}
		});
		proc.stderr.on ("data", (data) => {
			this.readStderrCallback (data);
			if (this.enableStderrReadLines) {
				this.stderrLineBuffer += data.toString ();
				this.parseLineBuffers ();
			}
		});
		proc.stderr.on ("end", () => {
			++endcount;
			if (endcount >= 3) {
				endRun ();
			}
		});

		proc.on ("error", (err) => {
			Log.err (`[ExecProcess ${proc.pid}] process error; execPath=${this.execPath} err=${err}`);
			endRun (err);
		});
		proc.on ("close", (code, signal) => {
			this.exitCode = code;
			this.exitSignal = (typeof signal == "string") ? signal : "";
			this.isExitSuccess = (this.exitCode == 0);
			++endcount;
			if (endcount >= 3) {
				endRun ();
			}
		});

		const endRun = (err) => {
			if (this.isEnded) {
				return;
			}
			this.isEnded = true;
			if (err != null) {
				if ((typeof this.endCallback == "function") && (! this.isEndCallbackExecuted)) {
					this.isEndCallbackExecuted = true;
					this.endCallback (err, this.isExitSuccess);
				}
				return;
			}
			if (! this.isReadPaused) {
				this.parseLineBuffers ();
			}
		};

		if (writedata != "") {
			setImmediate (() => {
				this.write (writedata);
			});
		}
		if (writeended) {
			setImmediate (() => {
				this.endWrite ();
			});
		}
	}

	// Pause the process's input events
	pauseEvents () {
		if (this.process == null) {
			return;
		}
		this.isReadPaused = true;
		this.process.stdout.pause ();
		this.process.stderr.pause ();
	}

	// Resume the process's input events
	resumeEvents () {
		if (this.process == null) {
			return;
		}
		this.process.stdout.resume ();
		this.process.stderr.resume ();
		this.isReadPaused = false;
	}

	// Parse any data contained in line buffers
	parseLineBuffers () {
		const endParse = () => {
			if (this.isReadPaused) {
				this.resumeEvents ();
			}
			if (this.isEnded) {
				if ((typeof this.endCallback == "function") && (! this.isEndCallbackExecuted)) {
					this.isEndCallbackExecuted = true;
					this.endCallback (null, this.isExitSuccess);
				}
			}
		};
		const lines = [ ];

		if (this.enableStdoutReadLines) {
			while (true) {
				const pos = this.stdoutLineBuffer.indexOf ("\n");
				if (pos < 0) {
					break;
				}
				const line = this.stdoutLineBuffer.substring (0, pos);
				this.stdoutLineBuffer = this.stdoutLineBuffer.substring (pos + 1);
				lines.push (line);
			}
		}
		if (this.enableStderrReadLines) {
			while (true) {
				const pos = this.stderrLineBuffer.indexOf ("\n");
				if (pos < 0) {
					break;
				}
				const line = this.stderrLineBuffer.substring (0, pos);
				this.stderrLineBuffer = this.stderrLineBuffer.substring (pos + 1);
				lines.push (line);
			}
		}

		if (lines.length <= 0) {
			endParse ();
			return;
		}
		this.pauseEvents ();
		this.readLinesCallback (lines, endParse);
	}
}
module.exports = ExecProcess;
