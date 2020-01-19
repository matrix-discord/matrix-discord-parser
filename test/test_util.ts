/*
Copyright 2020 matrix-discord

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import "mocha";
import { expect } from "chai";
import { Util } from "../src/util";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any no-magic-numbers */

describe("Util", () => {
    describe("NumberToHTMLColor", () => {
        it("should parse simple numbers to html color", () => {
            expect(Util.NumberToHTMLColor(0x123456)).to.equal("#123456");
        });
        it("should set color to zero if it is negative", () => {
            expect(Util.NumberToHTMLColor(-1)).to.equal("#000000");
        });
        it("should set color to max, if it is too high", () => {
            expect(Util.NumberToHTMLColor(0xFFFFFF + 1)).to.equal("#ffffff");
        });
        it("should zero-pad correctly", () => {
            expect(Util.NumberToHTMLColor(0x123)).to.equal("#000123");
        });
    });
});
