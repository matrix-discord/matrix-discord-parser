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

import * as Discord from "discord.js";
import { IMatrixMessage, IMatrixEvent } from "./matrixtypes";
import * as Parser from "node-html-parser";
import { Util } from "./util";
import * as highlightjs from "highlight.js";
import * as unescapeHtml from "unescape-html";

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 32;
const MATRIX_TO_LINK = "https://matrix.to/#/";
const DEFAULT_ROOM_NOTIFY_POWER_LEVEL = 50;

export interface IMatrixMessageParserCallbacks {
    canNotifyRoom: () => Promise<boolean>;
    getUserId: (mxid: string) => Promise<string | null>;
    getChannelId: (mxid: string) => Promise<string | null>;
    getEmoji: (mxc: string, name: string) => Promise<Discord.Emoji | null>;
    mxcUrlToHttp: (mxc: string) => string;
}

export interface IMatrixMessageParserOpts {
    callbacks: IMatrixMessageParserCallbacks;
    displayname: string;
    listDepth?: number;
    determineCodeLanguage?: boolean;
}

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
            // parser needs everything wrapped in html elements
            // so we wrap everything in <div> just to be sure stuff is wrapped
            // as <div> will be un-touched anyways
            const parsed = Parser.parse(`<div>${msg.formatted_body}</div>`, {
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
        // \u200B is the zero-width space --> they still look the same but don't mention
        msg = msg.replace(/@everyone/g, "@\u200Beveryone");
        msg = msg.replace(/@here/g, "@\u200Bhere");

        // Check the Matrix permissions to see if this user has the required
        // power level to notify with @room; if so, replace it with @here.
        if (msg.includes("@room") && await opts.callbacks.canNotifyRoom()) {
            msg = msg.replace(/@room/g, "@here");
        }
        const escapeChars = ["\\", "*", "_", "~", "`", "|"];
        msg = msg.split(" ").map((s) => {
            if (s.match(/^https?:\/\//)) {
                return s;
            }
            escapeChars.forEach((char) => {
                s = s.replace(new RegExp("\\" + char, "g"), "\\" + char);
            });
            return s;
        }).join(" ");
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
        const id = attrs.href.replace(MATRIX_TO_LINK, "");
        let reply = "";
        switch (id[0]) {
            case "@":
                // user pill
                reply = await this.parseUser(opts, id);
                break;
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
            const url = opts.callbacks.mxcUrlToHttp(src);
            return attrs.src ? `[${content}](${url})` : content;
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
        const entries = await this.arrayChildNodes(opts, node, ["li"]);
        this.listDepth--;
        const bulletPoint = this.listBulletPoints[this.listDepth % this.listBulletPoints.length];

        let msg = entries.map((s) => {
            return `${"    ".repeat(this.listDepth)}${bulletPoint} ${s}`;
        }).join("\n");

        if (this.listDepth === 0) {
            msg = `\n${msg}\n\n`;
        }
        return msg;
    }

    private async parseOlContent(opts: IMatrixMessageParserOpts, node: Parser.HTMLElement): Promise<string> {
        this.listDepth++;
        const entries = await this.arrayChildNodes(opts, node, ["li"]);
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
            msg = `\n${msg}\n\n`;
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
        await Util.AsyncForEach(node.childNodes, async (child) => {
            reply += await this.walkNode(opts, child);
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
                case "em":
                case "i":
                    return `*${await this.walkChildNodes(opts, nodeHtml)}*`;
                case "strong":
                case "b":
                    return `**${await this.walkChildNodes(opts, nodeHtml)}**`;
                case "u":
                    return `__${await this.walkChildNodes(opts, nodeHtml)}__`;
                case "del":
                    return `~~${await this.walkChildNodes(opts, nodeHtml)}~~`;
                case "code":
                    return `\`${nodeHtml.text}\``;
                case "pre":
                    return `\`\`\`${this.parsePreContent(opts, nodeHtml)}\`\`\``;
                case "a":
                    return await this.parsePillContent(opts, nodeHtml);
                case "img":
                    return await this.parseImageContent(opts, nodeHtml);
                case "br":
                    return "\n";
                case "blockquote":
                    return await this.parseBlockquoteContent(opts, nodeHtml);
                case "ul":
                    return await this.parseUlContent(opts, nodeHtml);
                case "ol":
                    return await this.parseOlContent(opts, nodeHtml);
                case "mx-reply":
                    return "";
                case "hr":
                    return "\n----------\n";
                case "h1":
                case "h2":
                case "h3":
                case "h4":
                case "h5":
                case "h6":
                    const level = parseInt(nodeHtml.tagName[1], 10);
                    return `**${"#".repeat(level)} ${await this.walkChildNodes(opts, nodeHtml)}**\n`;
                case "span":
                    return await this.parseSpanContent(opts, nodeHtml);
                default:
                    return await this.walkChildNodes(opts, nodeHtml);
            }
        }
        return "";
    }
}
