/*
Copyright 2017 - 2020 matrix-discord

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

import { IDiscordMessage, IDiscordMessageEmbed } from "./discordtypes";
import * as markdown from "discord-markdown";
import * as escapeHtml from "escape-html";
import { Util } from "./util";

const MATRIX_TO_LINK = "https://matrix.to/#/";
// somehow the regex works properly if it isn't global
// as we replace the match fully anyways this shouldn't be an issue
const MXC_INSERT_REGEX = /\x01emoji\x01(\w+)\x01([01])\x01([0-9]*)\x01/;
const NAME_MXC_INSERT_REGEX_GROUP = 1;
const ANIMATED_MXC_INSERT_REGEX_GROUP = 2;
const ID_MXC_INSERT_REGEX_GROUP = 3;
const EMOJI_SIZE = 32;
const MAX_EDIT_MSG_LENGTH = 50;

// same as above, no global flag here, too
const CHANNEL_INSERT_REGEX = /\x01chan\x01([0-9]*)\x01/;
const ID_CHANNEL_INSERT_REGEX = 1;

// same as above, no global flag here, too
const USER_INSERT_REGEX = /\x01user\x01([0-9]*)\x01/;
const ID_USER_INSERT_REGEX = 1;

export interface IDiscordMessageParserEntity {
    mxid: string;
    name: string;
}

export interface IDiscordMessageParserCallbacks {
    getUser: (id: string) => Promise<IDiscordMessageParserEntity | null>;
    getChannel: (id: string) => Promise<IDiscordMessageParserEntity | null>;
    getEmoji: (name: string, animated: boolean, id: string) => Promise<string | null>;
    getReference: (id: string) => Promise<IDiscordMessage | null>;
}

export interface IDiscordMessageParserOpts {
    callbacks: IDiscordMessageParserCallbacks;
}

export interface IDiscordMessageParserResult {
    formattedBody: string;
    body: string;
    msgtype: string;
}

interface ISpoilerNode {
    content: string;
}

interface IDiscordNode {
    id: string;
}

interface IEmojiNode extends IDiscordNode {
    animated: boolean;
    name: string;
}

export class DiscordMessageParser {
    public async FormatMessage(
        opts: IDiscordMessageParserOpts,
        msg: IDiscordMessage,
        replying: boolean = false
    ): Promise<IDiscordMessageParserResult> {
        const result: IDiscordMessageParserResult = {
            body: "",
            msgtype: "",
            formattedBody: "",
        };

        let content = msg.content;

        // for the formatted body we need to parse markdown first
        // as else it'll HTML escape the result of the discord syntax
        let contentPostmark = markdown.toHTML(content, {
            discordCallback: this.getDiscordParseCallbacksHTML(opts, msg),
            isBot: msg.author ? msg.author.bot : false,
            noExtraSpanTags: true,
            noHighlightCode: true,
        });

        // parse the plain text stuff
        content = markdown.toHTML(content, {
            discordCallback: this.getDiscordParseCallbacks(opts, msg),
            discordOnly: true,
            escapeHTML: false,
            isBot: msg.author ? msg.author.bot : false,
            noExtraSpanTags: true,
            noHighlightCode: true,
        });
        if (!replying) content = await this.InsertReply(opts, content, msg);
        content = this.InsertEmbeds(opts, content, msg);
        content = await this.InsertMxcImages(opts, content, msg);
        content = await this.InsertUserPills(opts, content, msg);
        content = await this.InsertChannelPills(opts, content, msg);

        // parse postmark stuff
        if (!replying) contentPostmark = await this.InsertReplyPostmark(opts, contentPostmark, msg);
        contentPostmark = this.InsertEmbedsPostmark(opts, contentPostmark, msg);
        contentPostmark = await this.InsertMxcImages(opts, contentPostmark, msg, true);
        contentPostmark = await this.InsertUserPills(opts, contentPostmark, msg, true);
        contentPostmark = await this.InsertChannelPills(opts, contentPostmark, msg, true);

        result.body = content;
        result.formattedBody = contentPostmark;
        result.msgtype = msg.author.bot ? "m.notice" : "m.text";
        return result;
    }

    public async FormatEdit(
        opts: IDiscordMessageParserOpts,
        oldMsg: IDiscordMessage,
        newMsg: IDiscordMessage,
        link?: string,
    ): Promise<IDiscordMessageParserResult> {
        oldMsg.embeds = []; // we don't want embeds on old msg
        const oldMsgParsed = await this.FormatMessage(opts, oldMsg);
        const newMsgParsed = await this.FormatMessage(opts, newMsg);
        const result: IDiscordMessageParserResult = {
            body: `*edit:* ~~${oldMsgParsed.body}~~ -> ${newMsgParsed.body}`,
            msgtype: newMsgParsed.msgtype,
            formattedBody: "",
        };
        oldMsg.content = `*edit:* ~~${oldMsg.content}~~ -> ${newMsg.content}`;
        const linkStart = link ? `<a href="${escapeHtml(link)}">` : "";
        const linkEnd = link ? "</a>" : "";
        if (oldMsg.content.includes("\n") || newMsg.content.includes("\n")
            || newMsg.content.length > MAX_EDIT_MSG_LENGTH) {
            result.formattedBody = `<p>${linkStart}<em>edit:</em>${linkEnd}</p><p><del>${oldMsgParsed.formattedBody}` +
                `</del></p><hr><p>${newMsgParsed.formattedBody}</p>`;
        } else {
            result.formattedBody = `${linkStart}<em>edit:</em>${linkEnd} <del>${oldMsgParsed.formattedBody}</del>` +
                ` -&gt; ${newMsgParsed.formattedBody}`;
        }
        return result;
    }

    public InsertEmbeds(opts: IDiscordMessageParserOpts, content: string, msg: IDiscordMessage): string {
        for (const embed of msg.embeds) {
            if (embed.title === undefined && embed.description === undefined) {
                continue;
            }
            if (this.isEmbedInBody(opts, msg, embed)) {
                continue;
            }
            let embedContent = content ? "\n\n----" : "";
            const embedTitle = embed.url ? `[${embed.title}](${embed.url})` : embed.title;
            if (embedTitle) {
                embedContent += "\n##### " + embedTitle; // h5 is probably best.
            }
            if (embed.author && embed.author.name) {
                embedContent += `\n**${escapeHtml(embed.author.name)}**`
            }
            if (embed.description) {
                embedContent += "\n" + markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordParseCallbacks(opts, msg),
                    discordOnly: true,
                    escapeHTML: false,
                    isBot: msg.author ? msg.author.bot : false,
                    noExtraSpanTags: true,
                    noHighlightCode: true,
                });
            }
            if (embed.fields) {
                for (const field of embed.fields) {
                    embedContent += `\n**${field.name}**\n`;
                    embedContent += markdown.toHTML(field.value, {
                        discordCallback: this.getDiscordParseCallbacks(opts, msg),
                        discordOnly: true,
                        escapeHTML: false,
                        isBot: msg.author ? msg.author.bot : false,
                        noExtraSpanTags: true,
                        noHighlightCode: true,
                    });
                }
            }
            if (embed.image) {
                embedContent += "\nImage: " + embed.image.url;
            }
            if (embed.footer) {
                embedContent += "\n" + markdown.toHTML(embed.footer.text, {
                    discordCallback: this.getDiscordParseCallbacks(opts, msg),
                    discordOnly: true,
                    escapeHTML: false,
                    isBot: msg.author ? msg.author.bot : false,
                    noExtraSpanTags: true,
                    noHighlightCode: true,
                });
            }
            content += embedContent;
        }
        return content;
    }

    public InsertEmbedsPostmark(opts: IDiscordMessageParserOpts, content: string, msg: IDiscordMessage): string {
        for (const embed of msg.embeds) {
            if (embed.title === undefined && embed.description === undefined) {
                continue;
            }
            if (this.isEmbedInBody(opts, msg, embed)) {
                continue;
            }
            let embedContent = content ? "<hr>" : "";
            const embedTitle = embed.url ?
                `<a href="${escapeHtml(embed.url)}">${escapeHtml(embed.title)}</a>`
                : (embed.title ? escapeHtml(embed.title) : undefined);
            if (embedTitle) {
                embedContent += `<h5>${embedTitle}</h5>`; // h5 is probably best.
            }
            if (embed.author && embed.author.name) {
                embedContent += `<strong>${escapeHtml(embed.author.name)}</strong><br>`
            }
            if (embed.description) {
                embedContent += "<p>";
                embedContent += markdown.toHTML(embed.description, {
                    discordCallback: this.getDiscordParseCallbacksHTML(opts, msg),
                    embed: true,
                    isBot: msg.author ? msg.author.bot : false,
                    noExtraSpanTags: true,
                    noHighlightCode: true,
                }) + "</p>";
            }
            if (embed.fields) {
                for (const field of embed.fields) {
                    embedContent += `<p><strong>${escapeHtml(field.name)}</strong><br>`;
                    embedContent += markdown.toHTML(field.value, {
                        discordCallback: this.getDiscordParseCallbacks(opts, msg),
                        embed: true,
                        isBot: msg.author ? msg.author.bot : false,
                        noExtraSpanTags: true,
                        noHighlightCode: true,
                    }) + "</p>";
                }
            }
            if (embed.image) {
                const imgUrl = escapeHtml(embed.image.url);
                embedContent += `<p>Image: <a href="${imgUrl}">${imgUrl}</a></p>`;
            }
            if (embed.footer) {
                embedContent += "<p>";
                embedContent += markdown.toHTML(embed.footer.text, {
                    discordCallback: this.getDiscordParseCallbacksHTML(opts, msg),
                    embed: true,
                    isBot: msg.author ? msg.author.bot : false,
                    noExtraSpanTags: true,
                    noHighlightCode: true,
                }) + "</p>";
            }
            content += embedContent;
        }
        return content;
    }

    public InsertUser(opts: IDiscordMessageParserOpts, node: IDiscordNode, msg: IDiscordMessage): string {
        // unfortunately these callbacks are sync, so we flag our channel with some special stuff
        // and later on grab the real channel pill async
        const FLAG = "\x01";
        return `${FLAG}user${FLAG}${node.id}${FLAG}`;
    }

    public InsertSpoiler(opts: IDiscordMessageParserOpts, node: ISpoilerNode, html: boolean = false): string {
        // matrix spoilers are still in MSC stage
        // see https://github.com/matrix-org/matrix-doc/pull/2010
        if (!html) {
            return `(Spoiler: ${node.content})`;
        }
        return `<span data-mx-spoiler>${node.content}</span>`;
    }

    public InsertChannel(opts: IDiscordMessageParserOpts, node: IDiscordNode): string {
        // unfortunately these callbacks are sync, so we flag our channel with some special stuff
        // and later on grab the real channel pill async
        const FLAG = "\x01";
        return `${FLAG}chan${FLAG}${node.id}${FLAG}`;
    }

    public InsertRole(
        opts: IDiscordMessageParserOpts,
        node: IDiscordNode,
        msg: IDiscordMessage,
        html: boolean = false,
    ): string {
        const id = node.id;
        const role = msg.guild ? (msg.guild.roles.resolve || msg.guild.roles.get)!.bind(msg.guild.roles)(id) : null;
        if (!role) {
            return html ? `&lt;@&amp;${id}&gt;` : `<@&${id}>`;
        }
        if (!html) {
            return `@${role.name}`;
        }
        const color = Util.NumberToHTMLColor(role.color);
        return `<span data-mx-color="${color}"><strong>@${escapeHtml(role.name)}</strong></span>`;
    }

    public InsertEmoji(opts: IDiscordMessageParserOpts, node: IEmojiNode): string {
        // unfortunately these callbacks are sync, so we flag our url with some special stuff
        // and later on grab the real url async
        const FLAG = "\x01";
        return `${FLAG}emoji${FLAG}${node.name}${FLAG}${node.animated ? 1 : 0}${FLAG}${node.id}${FLAG}`;
    }

    public InsertRoom(opts: IDiscordMessageParserOpts, msg: IDiscordMessage, def: string): string {
        return (msg.mentions && msg.mentions.everyone) || msg.mention_everyone ? "@room" : def;
    }

    public async InsertMxcImages(
        opts: IDiscordMessageParserOpts,
        content: string,
        msg: IDiscordMessage,
        html: boolean = false,
    ): Promise<string> {
        let results = MXC_INSERT_REGEX.exec(content);
        while (results !== null) {
            const name = results[NAME_MXC_INSERT_REGEX_GROUP];
            const animated = results[ANIMATED_MXC_INSERT_REGEX_GROUP] === "1";
            const id = results[ID_MXC_INSERT_REGEX_GROUP];
            let replace = "";
            const nameHtml = escapeHtml(name);
            const mxcUrl = await opts.callbacks.getEmoji(name, animated, id);
            if (mxcUrl) {
                if (html) {
                    replace = `<img alt=":${nameHtml}:" title=":${nameHtml}:" ` +
                        `height="${EMOJI_SIZE}" src="${mxcUrl}" data-mx-emoticon />`;
                } else {
                    replace = `:${name}:`;
                }
            } else {
                if (html) {
                    replace = `&lt;${animated ? "a" : ""}:${nameHtml}:${id}&gt;`;
                } else {
                    replace = `<${animated ? "a" : ""}:${name}:${id}>`;
                }
            }
            content = content.replace(results[0], replace);
            results = MXC_INSERT_REGEX.exec(content);
        }
        return content;
    }

    public async InsertUserPills(
        opts: IDiscordMessageParserOpts,
        content: string,
        msg: IDiscordMessage,
        html: boolean = false,
    ): Promise<string> {
        let results = USER_INSERT_REGEX.exec(content);
        while (results !== null) {
            const id = results[ID_USER_INSERT_REGEX];
            const user = await opts.callbacks.getUser(id);
            let replace = "";
            if (user) {
                replace = html ? `<a href="${MATRIX_TO_LINK}${escapeHtml(user.mxid)}">` +
                    `${escapeHtml(user.name)}</a>` : `${user.name} (${user.mxid})`;
            } else {
                replace = html ? `&lt;@${escapeHtml(id)}&gt;` : `<@${id}>`;
            }
            content = content.replace(results[0], replace);
            results = USER_INSERT_REGEX.exec(content);
        }
        return content;
    }

    public async InsertChannelPills(
        opts: IDiscordMessageParserOpts,
        content: string,
        msg: IDiscordMessage,
        html: boolean = false,
    ): Promise<string> {
        let results = CHANNEL_INSERT_REGEX.exec(content);
        while (results !== null) {
            const id = results[ID_CHANNEL_INSERT_REGEX];
            const channel = await opts.callbacks.getChannel(id);
            let replace = "";
            if (channel) {
                const name = "#" + channel.name;
                replace = html ? `<a href="${MATRIX_TO_LINK}${escapeHtml(channel.mxid)}">` +
                    `${escapeHtml(name)}</a>` : name;
            } else {
                replace = html ? `&lt;#${escapeHtml(id)}&gt;` : `<#${id}>`;
            }
            content = content.replace(results[0], replace);
            results = CHANNEL_INSERT_REGEX.exec(content);
        }
        return content;
    }

    public async InsertReply(
        opts: IDiscordMessageParserOpts,
        content: string,
        msg: IDiscordMessage,
    ): Promise<string> {
        if (!msg.reference) {
            return content;
        }
        const reply = await opts.callbacks.getReference(msg.reference.messageID);
        if (!reply) {
            return content;
        }
        const parsed_reply = await this.FormatMessage(opts, reply, true);
        content = `>  ${parsed_reply.body}\n\n${content}`;
        return content;
    }

    public async InsertReplyPostmark(
        opts: IDiscordMessageParserOpts,
        content: string,
        msg: IDiscordMessage,
    ): Promise<string> {
        if (!msg.reference) {
            return content;
        }
        const reply = await opts.callbacks.getReference(msg.reference.messageID);
        if (!reply) {
            return content;
        }
        const parsed_reply = await this.FormatMessage(opts, reply, true);
        // HACK! Doesn't resolve a username of a Matrix user into a pill, only Discord->Matrix.
        const user_pill = reply.webhookID == null ? this.InsertUser(opts, {"id": reply.author.id}, reply) : reply.author.username;
        content = `<mx-reply><blockquote><a>In reply to</a> ${user_pill}<br>${parsed_reply.formattedBody}</blockquote></mx-reply>${content}`;
        return content;
    }

    private isEmbedInBody(opts: IDiscordMessageParserOpts, msg: IDiscordMessage, embed: IDiscordMessageEmbed): boolean {
        if (!embed.url) {
            return false;
        }
        let url = embed.url;
        if (url.substr(url.length - 1) === "/") {
            url = url.substr(0, url.length - 1);
        }
        if (msg.content.includes(url)) {
            return true;
        }
        // alright, let's special-case youtu.be as it is meh
        // match for youtube URLs the video ID part
        const matchesFromUrl = url.match(/^https?:\/\/(?:www\.)youtube\.com\/watch\?.*v=([^&]+)/);
        if (matchesFromUrl) {
            const matchesFromContent = msg.content.match(/https?:\/\/youtu\.be\/([^\/? ]+)/);
            if (matchesFromContent && matchesFromUrl[1] === matchesFromContent[1]) {
                // okay, said youtube link is already in
                return true;
            }
        }
        return false;
    }

    private getDiscordParseCallbacks(opts: IDiscordMessageParserOpts, msg: IDiscordMessage) {
        return {
            channel: (node) => this.InsertChannel(opts, node), // are post-inserted
            emoji: (node) => this.InsertEmoji(opts, node), // are post-inserted
            everyone: (_) => this.InsertRoom(opts, msg, "@everyone"),
            here: (_) => this.InsertRoom(opts, msg, "@here"),
            role: (node) => this.InsertRole(opts, node, msg),
            spoiler: (node) => this.InsertSpoiler(opts, node),
            user: (node) => this.InsertUser(opts, node, msg),
        };
    }

    private getDiscordParseCallbacksHTML(opts: IDiscordMessageParserOpts, msg: IDiscordMessage) {
        return {
            channel: (node) => this.InsertChannel(opts, node), // are post-inserted
            emoji: (node) => this.InsertEmoji(opts, node), // are post-inserted
            everyone: (_) => this.InsertRoom(opts, msg, "@everyone"),
            here: (_) => this.InsertRoom(opts, msg, "@here"),
            role: (node) => this.InsertRole(opts, node, msg, true),
            spoiler: (node) => this.InsertSpoiler(opts, node, true),
            user: (node) => this.InsertUser(opts, node, msg),
        };
    }
}
