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
// Class that executes http and https requests

"use strict";

const App = global.App || { };
const Path = require ("path");
const Fs = require ("fs");
const Http = require ("http");
const Https = require ("https");
const StringUtil = require (Path.join (App.SOURCE_DIRECTORY, "StringUtil"));
const FsUtil = require (Path.join (App.SOURCE_DIRECTORY, "FsUtil"));
const Log = require (Path.join (App.SOURCE_DIRECTORY, "Log"));

class WebRequest {
	constructor (targetUrl) {
		// Read-write data members
		this.targetUrl = targetUrl;
		this.acceptAllHttps = false;
		this.userAgent = "";
		this.savePath = "";
		this.saveRandomFilename = false; // savePath must be a directory if this option is enabled

		// Read-only data members
		this.requestMethod = "GET";
		this.postData = "";
		this.requestCount = 0;
		this.successCount = 0;
	}

	// Execute HTTP GET for targetUrl and invoke endCallback (err, result) when complete. result contains response data as a string, or the save file path if savePath was assigned. If endCallback is not provided, instead return a Promise that executes the operation.
	get (endCallback) {
		this.requestMethod = "GET";
		return (this.execute (endCallback));
	}

	// Execute HTTP POST for targetUrl and invoke endCallback (err, result) when complete. result contains response data as a string, or the save file path if savePath was assigned. If endCallback is not provided, instead return a Promise that executes the operation.
	post (postData, endCallback) {
		this.requestMethod = "POST";
		if (typeof postData == "string") {
			this.postData = postData;
		}
		return (this.execute (endCallback));
	}

	// Execute the HTTP request for targetUrl and invoke endCallback (err, result) when complete. result contains response data as a string, or the save file path if savePath was assigned. If endCallback is not provided, instead return a Promise that executes the operation.
	execute (endCallback) {
		let url, savepath, writestream, https, req, reqdata, reqerr;

		const execute = async () => {
			const options = {
				protocol: "http:",
				method: this.requestMethod
			};
			url = null;
			if ((typeof this.targetUrl == "object") && (this.targetUrl != null)) {
				url = this.targetUrl;
			}
			else if (typeof this.targetUrl == "string") {
				url = StringUtil.parseUrl (this.targetUrl);
			}
			if (url == null) {
				throw Error ("Invalid URL");
			}

			https = false;
			options.hostname = url.hostname;
			if ((typeof options.hostname != "string") || (options.hostname == "")) {
				throw Error ("Invalid URL, missing hostname");
			}
			if (options.hostname.match (/[^a-zA-Z0-9-.]/)) {
				throw Error ("Invalid URL hostname");
			}
			if ((typeof url.port == "string") && (url.port != "")) {
				options.port = url.port;
				if (options.port.match (/[^0-9]/)) {
					throw Error ("Invalid URL port");
				}
			}
			if ((typeof url.pathname == "string") && (url.pathname != "")) {
				options.path = url.pathname;
			}
			if ((typeof url.search == "string") && (url.search != "")) {
				options.path = `${options.path}${url.search}`;
			}
			if ((typeof url.protocol == "string") && (url.protocol != "")) {
				https = url.protocol.match (/^https(:){0,1}/);
				if (https) {
					options.protocol = "https:";
				}
				else {
					if (! url.protocol.match (/^http(:){0,1}/)) {
						throw Error ("Unsupported URL protocol");
					}
				}
			}

			const headers = { };
			if (this.userAgent != "") {
				headers["User-Agent"] = this.userAgent;
			}
			if (Object.keys (headers).length > 0) {
				options.headers = headers;
			}
			if (https) {
				if (this.acceptAllHttps) {
					options.agent = new Https.Agent ({
						rejectUnauthorized: false
					});
				}
				else {
					const data = await FsUtil.readFile (App.TlsCaPath);
					const ca = data.toString ();
					if (ca.length <= 0) {
						throw Error ("Empty TLS CA data");
					}
					options.agent = new Https.Agent ({
						ca: [ ca ],
						rejectUnauthorized: true
					});
				}
			}

			savepath = "";
			writestream = null;
			if (this.savePath != "") {
				if (this.saveRandomFilename) {
					const stat = await FsUtil.statFile (this.savePath);
					if (! stat.isDirectory ()) {
						throw Error ("saveRandomFilename path exists but is not a directory");
					}
					savepath = await FsUtil.getTempFilename (Path.join (this.savePath, "web"));
				}
				else {
					savepath = this.savePath;
				}
			}
			if (savepath != "") {
				await new Promise ((resolve, reject) => {
					writestream = Fs.createWriteStream (savepath);
					writestream.once ("open", () => {
						resolve ();
					});
					writestream.once ("error", (err) => {
						writestream.close ();
						writestream = null;
						reject (err);
					});
				});
			}

			++(this.requestCount);
			reqerr = null;
			try {
				await new Promise ((resolve, reject) => {
					reqdata = (savepath != "") ? savepath : "";
					const requestStarted = (res) => {
						if (res.statusCode != 200) {
							reject (Error (`Non-success response code ${res.statusCode}`));
							return;
						}

						res.once ("error", (err) => {
							reject (err);
						});
						if (writestream != null) {
							res.on ("data", (data) => {
								writestream.write (data);
							});
						}
						else {
							res.on ("data", (data) => {
								if (typeof data == "string") {
									reqdata += data;
								}
								else if (Buffer.isBuffer (data)) {
									reqdata += data.toString ();
								}
							});
						}
						res.once ("end", () => {
							++(this.successCount);
							resolve ();
						});
					};
					if (https) {
						req = Https.request (options, requestStarted);
					}
					else {
						req = Http.request (options, requestStarted);
					}
					req.once ("error", (err) => {
						reject (err);
					});
					if (this.requestMethod == "POST") {
						req.write (this.postData);
						this.postData = "";
					}
					req.end ();
				});
			}
			catch (err) {
				reqerr = err;
			}

			if (writestream != null) {
				await new Promise ((resolve, reject) => {
					writestream.once ("finish", () => {
						resolve ();
					});
					writestream.end ();
				});
			}
			if (reqerr != null) {
				if (savepath != "") {
					try {
						await FsUtil.removeFile (savepath);
					}
					catch (err) {
						Log.debug (`Failed to remove WebRequest temp file; path=${savepath}`);
					}
				}
				throw reqerr;
			}
			return (reqdata);
		};

		if (typeof endCallback == "function") {
			execute ().then ((result) => {
				endCallback (null, result);
			}).catch ((err) => {
				endCallback (err);
			});
		}
		else {
			return (execute ());
		}
	}
}
module.exports = WebRequest;
