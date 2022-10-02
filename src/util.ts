/*
Copyright 2019 matrix-discord

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

export class Util {
    public static NumberToHTMLColor(color: number): string {
        const HEX_BASE = 16;
        const COLOR_MAX = 0xFFFFFF;
        if (color > COLOR_MAX) {
            color = COLOR_MAX;
        }
        if (color < 0) {
            color = 0;
        }
        const colorHex = color.toString(HEX_BASE);
        const pad = "#000000";
        const htmlColor = pad.substring(0, pad.length - colorHex.length) + colorHex;
        return htmlColor;
    }

    public static Rot13(plaintext: string): string {
        const UPPER_Z = 90;
        const LOWER_Z = 122;
        const CAESAR_SHIFT = 13;
        const ALPHABET_LENGTH = 26;
        return plaintext.replace(/[a-zA-Z]/g, (c) => {
            const code = c.charCodeAt(0);
            let shiftedCode = code + CAESAR_SHIFT;
            if ((code <= UPPER_Z && shiftedCode > UPPER_Z)
                || (code <= LOWER_Z && shiftedCode > LOWER_Z)) {
                shiftedCode = shiftedCode - ALPHABET_LENGTH;
            }
            return String.fromCharCode(shiftedCode);
        });
    }

    public static async AsyncForEach(arr, callback) {
        for (let i = 0; i < arr.length; i++) {
            await callback(arr[i], i, arr);
        }
    }
}
