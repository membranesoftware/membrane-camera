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
// Class that handles manipulation of IPv4 addresses

"use strict";

class Ipv4Address {
	constructor (address) {
		this.isValid = false;
		this.octets = [ ];
		this.netmaskOctets = [ ];

		this.parse (address);
	}

	// Return a string representation of the address, or an empty string if the address has not parsed a valid source value
	toString () {
		if (! this.isValid) {
			return ("");
		}
		return (this.octets.join ("."));
	}

	// Parse the provided address string and store the resulting values
	parse (address) {
		let match, i, num;

		this.isValid = false;
		if (typeof address != "string") {
			return;
		}
		match = address.match (/^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$/);
		if (match == null) {
			return;
		}
		this.octets = [ ];
		for (i = 1; i < 5; ++i) {
			num = parseInt (match[i], 10);
			if (isNaN (num)) {
				return;
			}
			if ((num < 0) || (num > 255)) {
				return;
			}
			this.octets.push (num);
		}

		this.netmaskOctets = [ ];
		this.isValid = true;
	}

	// Set the netmask value associated with the address
	setNetmask (netmask) {
		let match, i, num;

		if (typeof netmask != "string") {
			return;
		}
		match = netmask.match (/^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$/);
		if (match == null) {
			return;
		}
		this.netmaskOctets = [ ];
		for (i = 1; i < 5; ++i) {
			num = parseInt (match[i], 10);
			if (isNaN (num)) {
				return;
			}
			if ((num < 0) || (num > 255)) {
				return;
			}
			this.netmaskOctets.push (num);
		}
	}

	// Return a string containing the object's broadcast address, as composed from previously provided address and netmask values, or an empty string if the broadcast address could not be determined
	getBroadcastAddress () {
		let i, addr, num, inverse;

		if ((! this.isValid) || (this.netmaskOctets.length != 4)) {
			return ("");
		}

		addr = [ ];
		for (i = 0; i < 4; ++i) {
			num = this.octets[i];
			num &= this.netmaskOctets[i];
			inverse = ~(this.netmaskOctets[i]);
			inverse &= 0xFF;
			inverse >>>= 0;
			num |= inverse;
			num >>>= 0;
			addr.push (num);
		}

		return (addr.join ("."));
	}

	// Return a boolean value indicating if the address has parsed successfully and holds a localhost value
	isLocalhost () {
		if (! this.isValid) {
			return (false);
		}

		if ((this.octets[0] == 127) && (this.octets[1] == 0) && (this.octets[2] == 0) && (this.octets[3] == 1)) {
			return (true);
		}

		return (false);
	}
}

module.exports = Ipv4Address;
