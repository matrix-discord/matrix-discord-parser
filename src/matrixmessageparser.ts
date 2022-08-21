/*
Copyright 2018 - 2020 matrix-discord

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

import { IDiscordEmoji } from "./discordtypes";
import { IMatrixMessage, IMatrixEvent } from "./matrixtypes";
import * as Parser from "node-html-parser";
import { Util } from "./util";
import * as highlightjs from "highlight.js";
import * as unescapeHtml from "unescape-html";
import got from "got";

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const MATRIX_TO_LINK = "https://matrix.to/#/";
const DEFAULT_ROOM_NOTIFY_POWER_LEVEL = 50;

export interface IMatrixMessageParserCallbacks {
    canNotifyRoom: () => Promise<boolean>;
    getUserId: (mxid: string) => Promise<string | null>;
    getChannelId: (mxid: string) => Promise<string | null>;
    getEmoji: (mxc: string, name: string) => Promise<IDiscordEmoji | null>;
    mxcUrlToHttp: (mxc: string) => string;
}

export interface IMatrixMessageParserUrlShortener {
    endpoint?: string;
    extraBody?: any; // tslint:disable-line no-any
    urlParameter?: string;
    shortParameter?: string;
    method?: string;
}

const DEFAULT_URL_SHORTENER: IMatrixMessageParserUrlShortener = {
    endpoint: "https://mau.lu/api/shorten",
    method: "POST",
    shortParameter: "short_url",
    urlParameter: "url",
};

export interface IMatrixMessageParserOpts {
    callbacks: IMatrixMessageParserCallbacks;
    displayname: string;
    urlShortener?: IMatrixMessageParserUrlShortener;
    listDepth?: number;
    determineCodeLanguage?: boolean;
}

// these are the tags that are supposed to act like block tag markdown forming on the *discord* side
const BLOCK_TAGS = ["BLOCKQUOTE", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6"];

export class MatrixMessageParser {
    private listDepth: number = 0;
    private listBulletPoints: string[] = ["●", "○", "■", "‣"];
    public async FormatMessage(
        opts: IMatrixMessageParserOpts,
        msg: IMatrixMessage,
    ): Promise<string> {
        opts.listDepth = 0;
        let reply = "";
        if (msg.formatted_body) {
            const parsed = Parser.parse(msg.formatted_body, {
                lowerCaseTagName: true,
                pre: true,
            // tslint:disable-next-line no-any
            } as any);
            reply = await this.walkNode(opts, parsed);
            reply = reply.replace(/\s*$/, ""); // trim off whitespace at end
        } else {
            reply = await this.escapeDiscord(opts, msg.body);
        }

        if (msg.msgtype === "m.emote") {
            if (opts.displayname.length >= MIN_NAME_LENGTH &&
                opts.displayname.length <= MAX_NAME_LENGTH) {
                reply = `_${await this.escapeDiscord(opts, opts.displayname)} ${reply}_`;
            } else {
                reply = `_${reply}_`;
            }
        }
        return reply;
    }

    private async escapeDiscord(opts: IMatrixMessageParserOpts, msg: string): Promise<string> {
        msg = unescapeHtml(msg);
        // \u200B is the zero-width space --> they still look the same but don't mention
        msg = msg.replace(/@everyone/g, "@\u200Beveryone");
        msg = msg.replace(/@here/g, "@\u200Bhere");

        // Check the Matrix permissions to see if this user has the required
        // power level to notify with @room; if so, replace it with @here.
        if (msg.includes("@room") && await opts.callbacks.canNotifyRoom()) {
            msg = msg.replace(/@room/g, "@here");
        }
        const escapeChars = ["\\", "*", "_", "~", "`", "|", ":", "<", ">"];
        const escapeDiscordInternal = (s: string): string => {
            const match = s.match(/\bhttps?:\/\//);
            if (match) {
                return escapeDiscordInternal(s.substring(0, match.index)) + s.substring(match.index as number);
            }
            escapeChars.forEach((char) => {
                s = s.replace(new RegExp("\\" + char, "g"), "\\" + char);
            });
            return s;
        };
        const parts: string[] = msg.split(/\s/).map(escapeDiscordInternal);
        const whitespace = msg.replace(/\S/g, "");
        msg = parts[0];
        for (let i = 0; i < whitespace.length; i++) {
            msg += whitespace[i] + parts[i + 1];
        }
        return msg;
    }

    private parsePreContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): string {
        let text = node.text;
        const match = text.match(/^<code([^>]*)>/i);
        if (!match) {
            text = unescapeHtml(text);
            if (text[0] !== "\n") {
                text = "\n" + text;
            }
            return text;
        }
        // remove <code> opening-tag
        text = text.substr(match[0].length);
        // remove </code> closing tag
        text = text.replace(/<\/code>$/i, "");
        text = unescapeHtml(text);
        if (text[0] !== "\n") {
            text = "\n" + text;
        }
        const language = match[1].match(/language-(\w*)/i);
        if (language) {
            text = language[1] + text;
        } else if (opts.determineCodeLanguage) {
            text = highlightjs.highlightAuto(text).language + text;
        }
        return text;
    }

    private async parseUser(opts: IMatrixMessageParserOpts, id: string): Promise<string> {
        const retId = await opts.callbacks.getUserId(id);
        if (!retId) {
            return "";
        }
        return `<@${retId}>`;
    }

    private async parseChannel(opts: IMatrixMessageParserOpts, id: string): Promise<string> {
        const retId = await opts.callbacks.getChannelId(id);
        if (!retId) {
            return "";
        }
        return `<#${retId}>`;
    }

    private async parseLinkContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        const attrs = node.attributes;
        const content = await this.walkChildNodes(opts, node);
        if (!attrs.href || content === attrs.href) {
            return content;
        }
        return `[${content}](${attrs.href})`;
    }

    private async parsePillContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        const attrs = node.attributes;
        if (!attrs.href || !attrs.href.startsWith(MATRIX_TO_LINK)) {
            return await this.parseLinkContent(opts, node);
        }
        // Some matrix clients URL encode the matrix.to link
        const url = decodeURI(attrs.href);
        const id = url.replace(MATRIX_TO_LINK, "");
        let reply = "";
        switch (id[0]) {
            case "@":
                // user pill
                reply = await this.parseUser(opts, id);
                // don't fall back to parseLinkContent, we don't want matrix.to URL previews
                // for all Matrix mentions of non-Discord users.
                return reply || await this.walkChildNodes(opts, node);
            case "#":
                reply = await this.parseChannel(opts, id);
                break;
        }
        if (!reply) {
            return await this.parseLinkContent(opts, node);
        }
        return reply;
    }

    private async parseImageContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        const EMOTE_NAME_REGEX = /^:?(\w+):?/;
        const attrs = node.attributes;
        const src = attrs.src || "";
        const name = attrs.alt || attrs.title || "";
        const emoji = await opts.callbacks.getEmoji(src, name);

        if (!emoji) {
            const content = await this.escapeDiscord(opts, name);
            if (!src) {
                return content;
            }
            let url = opts.callbacks.mxcUrlToHttp(src);
            const shortener = opts.urlShortener || DEFAULT_URL_SHORTENER;
            if (shortener.endpoint && shortener.urlParameter && shortener.shortParameter) {
                const body: any = shortener.extraBody || {}; // tslint:disable-line no-any
                body[shortener.urlParameter] = url;
                try {
                    const res = await got({
                        json: body,
                        method: shortener.method as any || "POST", // tslint:disable-line no-any
                        url: shortener.endpoint,
                    }).json();
                    let resJson: any; // tslint:disable-line no-any
                    if (typeof res === "string") {
                        resJson = JSON.parse(res);
                    } else {
                        resJson = res;
                    }
                    if (typeof resJson[shortener.shortParameter] === "string") {
                        url = resJson[shortener.shortParameter];
                    }
                } catch (err) { } // do nothing
            }
            return `[${content} ${url} ]`;
        }
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
    }

    private async parseBlockquoteContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        let msg = await this.walkChildNodes(opts, node);

        msg = msg.split("\n").map((s) => {
            return "> " + s;
        }).join("\n");
        msg = msg + "\n"; // discord quotes don't require an extra new line to end them
        return msg;
    }

    private async parseSpanContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        const content = await this.walkChildNodes(opts, node);
        const attrs = node.attributes;
        // matrix spoilers are still in MSC stage
        // see https://github.com/matrix-org/matrix-doc/pull/2010
        if (attrs["data-mx-spoiler"] !== undefined) {
            const spoilerReason = attrs["data-mx-spoiler"];
            if (spoilerReason) {
                return `(${spoilerReason})||${content}||`;
            }
            return `||${content}||`;
        }
        return content;
    }

    private async parseUlContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        this.listDepth++;
        const entries = await this.arrayChildNodes(opts, node, ["LI"]);
        this.listDepth--;
        const bulletPoint = this.listBulletPoints[this.listDepth % this.listBulletPoints.length];

        let msg = entries.map((s) => {
            return `${"    ".repeat(this.listDepth)}${bulletPoint} ${s}`;
        }).join("\n");

        if (this.listDepth === 0) {
            msg = `${msg}\n\n`;
        }
        return msg;
    }

    private async parseOlContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        this.listDepth++;
        const entries = await this.arrayChildNodes(opts, node, ["LI"]);
        this.listDepth--;
        let entry = 0;
        const attrs = node.attributes;
        if (attrs.start && attrs.start.match(/^[0-9]+$/)) {
            entry = parseInt(attrs.start, 10) - 1;
        }

        let msg = entries.map((s) => {
            entry++;
            return `${"    ".repeat(this.listDepth)}${entry}. ${s}`;
        }).join("\n");

        if (this.listDepth === 0) {
            msg = `${msg}\n\n`;
        }
        return msg;
    }

    private async arrayChildNodes(
        opts: IMatrixMessageParserOpts,
        node: Parser.Node,
        types: string[] = [],
    ): Promise<string[]> {
        const replies: string[] = [];
        await Util.AsyncForEach(node.childNodes, async (child) => {
            if (types.length && (
                child.nodeType === Parser.NodeType.TEXT_NODE
                || !types.includes((child as Parser.HTMLElement).tagName)
            )) {
                return;
            }
            replies.push(await this.walkNode(opts, child));
        });
        return replies;
    }

    private async walkChildNodes(opts: IMatrixMessageParserOpts, node: Parser.Node): Promise<string> {
        let reply = "";
        let lastTag = "";
        await Util.AsyncForEach(node.childNodes, async (child) => {
            const thisTag = child.nodeType === Parser.NodeType.ELEMENT_NODE
                ? (child as Parser.HTMLElement).tagName : "";
            if (thisTag === "P" && lastTag === "P") {
                reply += "\n\n";
            } else if (BLOCK_TAGS.includes(thisTag) && reply && reply[reply.length - 1] !== "\n") {
                reply += "\n";
            }
            reply += await this.walkNode(opts, child);
            lastTag = thisTag;
        });
        return reply;
    }

    private async walkNode(opts: IMatrixMessageParserOpts, node: Parser.Node): Promise<string> {
        if (node.nodeType === Parser.NodeType.TEXT_NODE) {
            // ignore \n between single nodes
            if ((node as Parser.TextNode).text === "\n") {
                return "";
            }
            return await this.escapeDiscord(opts, (node as Parser.TextNode).text);
        } else if (node.nodeType === Parser.NodeType.ELEMENT_NODE) {
            const nodeHtml = node as Parser.HTMLElement;
            switch (nodeHtml.tagName) {
                case "EM":
                case "I":
                    return `*${await this.walkChildNodes(opts, nodeHtml)}*`;
                case "STRONG":
                case "B":
                    return `**${await this.walkChildNodes(opts, nodeHtml)}**`;
                case "U":
                case "INS":
                    return `__${await this.walkChildNodes(opts, nodeHtml)}__`;
                case "DEL":
                case "STRIKE":
                case "S":
                    return `~~${await this.walkChildNodes(opts, nodeHtml)}~~`;
                case "CODE":
                    return `\`${nodeHtml.text}\``;
                case "PRE":
                    return `\`\`\`${this.parsePreContent(opts, nodeHtml)}\`\`\``;
                case "A":
                    return await this.parsePillContent(opts, nodeHtml);
                case "IMG":
                    return await this.parseImageContent(opts, nodeHtml);
                case "BR":
                    return "\n";
                case "BLOCKQUOTE":
                    return await this.parseBlockquoteContent(opts, nodeHtml);
                case "UL":
                    return await this.parseUlContent(opts, nodeHtml);
                case "OL":
                    return await this.parseOlContent(opts, nodeHtml);
                case "MX-REPLY":
                    return "";
                case "HR":
                    return "\n----------\n";
                case "H1":
                case "H2":
                case "H3":
                case "H4":
                case "H5":
                case "H6": {
                    const level = parseInt(nodeHtml.tagName[1], 10);
                    let content = await this.walkChildNodes(opts, nodeHtml);
                    const MAX_UPPERCASE_LEVEL = 2;
                    if (level <= MAX_UPPERCASE_LEVEL) {
                        content = content.toUpperCase();
                    }
                    let prefix = "";
                    if (level > 1) {
                        prefix = "#".repeat(level) + " ";
                    }
                    return `**${prefix}${content}**\n`;
                }
                case "SPAN":
                    return await this.parseSpanContent(opts, nodeHtml);
                default:
                    return await this.walkChildNodes(opts, nodeHtml);
            }
        }
        return "";
    }
}
