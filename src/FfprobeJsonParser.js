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
// Class that parses json-formatted data from an ffprobe process and stores gathered metadata fields

"use strict";

const App = global.App || { };
const Log = require (App.SOURCE_DIRECTORY + "/Log");

class FfprobeJsonParser {
	constructor (sourceName) {
		this.sourceName = sourceName;
		if (typeof this.sourceName != "string") {
			this.sourceName = "";
		}

		// Read-only data members
		this.isParseSuccess = false;
		this.isClosed = false;
		this.videoStreamIndex = null;
		this.audioStreamIndex = null;
		this.duration = null; // milliseconds
		this.bitrate = null; // bits per second
		this.videoCodec = null;
		this.pixelFormat = null;
		this.width = null;
		this.height = null;
		this.videoBitrate = null; // bits per second
		this.frameRate = null; // frames per second

		this.parseData = "";
	}

	// Return a string representation of parsed fields
	toString () {
		return (`<name=${this.sourceName} videoStreamIndex=${this.videoStreamIndex} audioStreamIndex=${this.audioStreamIndex} duration=${this.duration} bitrate=${this.bitrate} videoCodec=${this.videoCodec} pixelFormat=${this.pixelFormat} width=${this.width} height=${this.height} videoBitrate=${this.videoBitrate} frameRate=${this.frameRate}>`);
	}

	// Parse an array of strings containing ffprobe output lines
	parseLines (lines) {
		if (this.isClosed) {
			return;
		}

		this.parseData += lines.join ("");
	}

	// End parsing and extract metadata from received ffprobe output lines
	close () {
		let d, format, n, matches;

		this.isClosed = true;
		try {
			d = JSON.parse (this.parseData);
		}
		catch (e) {
			return;
		}
		this.isParseSuccess = false;
		this.videoStreamIndex = null;
		this.audioStreamIndex = null;
		this.duration = null;
		this.bitrate = null;
		this.videoCodec = null;
		this.pixelFormat = null;
		this.width = null;
		this.height = null;
		this.videoBitrate = null;
		this.frameRate = null;

		format = d.format;
		if ((typeof format == "object") && (format != null)) {
			n = parseFloat (format.duration);
			if (isNaN (n) || (n <= 0)) {
				return;
			}
			this.duration = Math.floor (n * 1000);

			n = parseFloat (format.bit_rate);
			if (isNaN (n) || (n <= 0)) {
				return;
			}
			this.bitrate = Math.floor (n);
		}

		if (Array.isArray (d.streams)) {
			for (let stream of d.streams) {
				if ((stream.codec_type == "video") && (this.videoStreamIndex == null)) {
					this.videoStreamIndex = stream.index;
					if (typeof this.videoStreamIndex != "number") {
						return;
					}

					this.videoCodec = stream.codec_name;
					if (typeof this.videoCodec != "string") {
						return;
					}

					this.pixelFormat = stream.pix_fmt;
					if (typeof this.pixelFormat != "string") {
						return;
					}

					this.width = stream.width;
					if ((typeof this.width != "number") || (this.width <= 0)) {
						return;
					}

					this.height = stream.height;
					if ((typeof this.height != "number") || (this.height <= 0)) {
						return;
					}

					n = parseFloat (stream.bit_rate);
					if (isNaN (n) || (n <= 0)) {
						return;
					}
					this.videoBitrate = Math.floor (n);

					if (typeof stream.avg_frame_rate != "string") {
						return;
					}
					matches = stream.avg_frame_rate.match (/([0-9]+)\/([0-9]+)/);
					if (matches == null) {
						return;
					}
					n = parseFloat (matches[1]);
					if (isNaN (n) || (n <= 0)) {
						return;
					}
					this.frameRate = n;

					n = parseFloat (matches[2]);
					if (isNaN (n) || (n <= 0)) {
						return;
					}
					this.frameRate /= n;
					this.frameRate = (Math.floor (this.frameRate * 100)) / 100;
				}

				if ((stream.codec_type == "audio") && (this.audioStreamIndex == null)) {
					this.audioStreamIndex = stream.index;
					if (typeof this.audioStreamIndex != "number") {
						return;
					}
				}
			}
		}

		if ((this.videoStreamIndex === null) || (this.duration === null) || (this.bitrate === null) || (this.videoCodec === null) || (this.pixelFormat === null) || (this.width === null) || (this.height === null) || (this.videoBitrate === null) || (this.frameRate === null)) {
			return;
		}

		this.isParseSuccess = true;
	}
}
module.exports = FfprobeJsonParser;
