/*
Copyright 2019, 2020 matrix-discord

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
import { DiscordMessageParser } from "../src/discordmessageparser";
import * as Discord from "discord.js";

// we are a test file and thus need those
/* tslint:disable:no-unused-expression max-file-line-count no-any */

function getMessageParserOpts(callbacksSet: any = {}) {
    const callbacks = Object.assign({
        getChannel: async (id) => {
            if (id === "123") {
                return null;
            }
            return {
                mxid: "#_discord_1234_12345:localhost",
                name: "foxies",
            };
        },
        getEmoji: async (name, animated, id) => name !== "unknown" ? "mxc://localhost/" + name : null,
        getUser: async (id) => {
            if (id === "123") {
                return null;
            }
            return {
                mxid: "@_discord_12345:localhost",
                name: "foxies",
            };
        },
    }, callbacksSet);
    return {
        callbacks,
    };
}

function getMessage(str: string, bot: boolean = false, mentionEveryone: boolean = false, embeds: any[] = []) {
    const guild = new Discord.Guild({
        resolver: {
            resolveGuildMember: (a, b) => undefined,
        },
    } as any, {
        emojis: [],
        id: "1234",
    });
    const role = new Discord.Role(guild, {
        color: 0x123456,
        id: "123456",
        name: "Fox Lover",
    });
    guild.roles.set("123456", role);
    const author = new Discord.User({} as any, {
        bot,
    });
    const channel = new Discord.TextChannel(guild, {} as any);
    const msg = new Discord.Message(channel, {
        attachments: [],
        content: str,
        embeds,
        mention_everyone: mentionEveryone,
    }, {
        dataManager: {
            newUser: (a, b) => author,
        },
    } as any);
    return msg;
}

const defaultOpts = getMessageParserOpts();

describe("DiscordMessageParser", () => {
    describe("FormatMessage", () => {
        it("processes plain text messages correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("hello world!");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("hello world!");
            expect(result.formattedBody).is.equal("hello world!");
        });
        it("processes markdown messages correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("Hello *World*!");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("Hello *World*!");
            expect(result.formattedBody).is.equal("Hello <em>World</em>!");
        });
        it("processes non-discord markdown correctly", async () => {
            const mp = new DiscordMessageParser();
            let msg = getMessage(">inb4 tests");
            let result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(">inb4 tests");
            expect(result.formattedBody).is.equal("&gt;inb4 tests");

            msg = getMessage("[test](http://example.com)");
            result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("[test](http://example.com)");
            expect(result.formattedBody).is.equal("[test](<a href=\"http://example.com\">http://example.com</a>)");
        });
        it("processes discord-specific markdown correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("_ italic _");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("_ italic _");
            expect(result.formattedBody).is.equal("<em> italic </em>");
        });
        it("replaces @everyone correctly", async () => {
            const mp = new DiscordMessageParser();
            let msg = getMessage("hey @everyone!");
            let result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("hey @everyone!");
            expect(result.formattedBody).is.equal("hey @everyone!");

            msg = getMessage("hey @everyone!", false, true);
            result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("hey @room!");
            expect(result.formattedBody).is.equal("hey @room!");
        });
        it("replaces @here correctly", async () => {
            const mp = new DiscordMessageParser();
            let msg = getMessage("hey @here!");
            let result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("hey @here!");
            expect(result.formattedBody).is.equal("hey @here!");

            msg = getMessage("hey @here!", false, true);
            result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("hey @room!");
            expect(result.formattedBody).is.equal("hey @room!");
        });
        it("replaces blockquotes correctly", async () => {
            const mp = new DiscordMessageParser();
            let msg = getMessage("> quote\nfox");
            let result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("> quote\nfox");
            expect(result.formattedBody).is.equal("<blockquote>quote<br></blockquote>fox");

            msg = getMessage("text\n>>> quote\nmultiline", false, true);
            result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("text\n>>> quote\nmultiline");
            expect(result.formattedBody).is.equal("text<br><blockquote>quote<br>multiline</blockquote>");
        });
    });
    describe("FormatEmbeds", () => {
        it("processes discord-specific markdown correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("message", false, false, [
                {
                    author: {} as any,
                    client: {} as any,
                    color: {} as any,
                    createdAt: {} as any,
                    createdTimestamp: {} as any,
                    description: "Description",
                    fields: [] as any,
                    footer: undefined as any,
                    hexColor: {} as any,
                    image: undefined as any,
                    message: {} as any,
                    provider: {} as any,
                    thumbnail: {} as any,
                    title: "Title",
                    type: {} as any,
                    url: "http://example.com",
                    video: {} as any,
                },
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("message\n\n----\n##### [Title](http://example.com)\nDescription");
            expect(result.formattedBody).is.equal("message<hr><h5><a href=\"http://example.com\">Title</a>" +
                "</h5><p>Description</p>");
        });
        it("should ignore same-url embeds", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("message http://example.com", false, false, [
                {
                    author: {} as any,
                    client: {} as any,
                    color: {} as any,
                    createdAt: {} as any,
                    createdTimestamp: {} as any,
                    description: "Description",
                    fields: [] as any,
                    footer: {} as any,
                    hexColor: {} as any,
                    image: {} as any,
                    message: {} as any,
                    provider: {} as any,
                    thumbnail: {} as any,
                    title: "Title",
                    type: {} as any,
                    url: "http://example.com",
                    video: {} as any,
                },
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("message http://example.com");
            expect(result.formattedBody).is.equal("message <a href=\"http://example.com\">" +
                "http://example.com</a>");
        });
        it("should ignore same-url embeds with trailing slash", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("message http://example.com", false, false, [
                {
                    author: {} as any,
                    client: {} as any,
                    color: {} as any,
                    createdAt: {} as any,
                    createdTimestamp: {} as any,
                    description: "Description",
                    fields: [] as any,
                    footer: {} as any,
                    hexColor: {} as any,
                    image: {} as any,
                    message: {} as any,
                    provider: {} as any,
                    thumbnail: {} as any,
                    title: "Title",
                    type: {} as any,
                    url: "http://example.com/",
                    video: {} as any,
                },
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("message http://example.com");
            expect(result.formattedBody).is.equal("message <a href=\"http://example.com\">" +
                "http://example.com</a>");
        });
        it("should ignore same-url embeds that are youtu.be", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("message https://youtu.be/blah blubb", false, false, [
                {
                    author: {} as any,
                    client: {} as any,
                    color: {} as any,
                    createdAt: {} as any,
                    createdTimestamp: {} as any,
                    description: "Description",
                    fields: [] as any,
                    footer: {} as any,
                    hexColor: {} as any,
                    image: {} as any,
                    message: {} as any,
                    provider: {} as any,
                    thumbnail: {} as any,
                    title: "Title",
                    type: {} as any,
                    url: "https://www.youtube.com/watch?v=blah",
                    video: {} as any,
                },
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("message https://youtu.be/blah blubb");
            expect(result.formattedBody).is.equal("message <a href=\"https://youtu.be/blah\">" +
                "https://youtu.be/blah</a> blubb");
        });
    });
    describe("FormatEdit", () => {
        it("should format basic edits appropriately", async () => {
            const mp = new DiscordMessageParser();
            const msg1 = getMessage("a");
            const msg2 = getMessage("b");
            const result = await mp.FormatEdit(defaultOpts, msg1, msg2);
            expect(result.body).is.equal("*edit:* ~~a~~ -> b");
            expect(result.formattedBody).is.equal("<em>edit:</em> <del>a</del> -&gt; b");
        });
        it("should format markdown heavy edits apropriately", async () => {
            const mp = new DiscordMessageParser();
            const msg1 = getMessage("a slice of **cake**");
            const msg2 = getMessage("*a* slice of cake");
            const result = await mp.FormatEdit(defaultOpts, msg1, msg2);
            expect(result.body).is.equal("*edit:* ~~a slice of **cake**~~ -> *a* slice of cake");
            expect(result.formattedBody).is.equal("<em>edit:</em> <del>a slice of <strong>" +
              "cake</strong></del> -&gt; <em>a</em> slice of cake");
        });
        it("should format discord fail edits correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg1 = getMessage("~~fail~");
            const msg2 = getMessage("~~fail~~");
            const result = await mp.FormatEdit(defaultOpts, msg1, msg2);
            expect(result.body).is.equal("*edit:* ~~~~fail~~~ -> ~~fail~~");
            expect(result.formattedBody).is.equal("<em>edit:</em> <del>~~fail~</del> -&gt; <del>fail</del>");
        });
        it("should format multiline edits correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg1 = getMessage("multi\nline");
            const msg2 = getMessage("multi\nline\nfoxies");
            const result = await mp.FormatEdit(defaultOpts, msg1, msg2);
            expect(result.body).is.equal("*edit:* ~~multi\nline~~ -> multi\nline\nfoxies");
            expect(result.formattedBody).is.equal("<p><em>edit:</em></p><p><del>multi<br>line</del></p><hr>" +
                "<p>multi<br>line<br>foxies</p>");
        });
        it("should add old message link", async () => {
            const mp = new DiscordMessageParser();
            const msg1 = getMessage("fox");
            const msg2 = getMessage("foxies");
            const result = await mp.FormatEdit(defaultOpts, msg1, msg2, "https://matrix.to/#/old");
            expect(result.body).is.equal("*edit:* ~~fox~~ -> foxies");
            expect(result.formattedBody).is.equal("<a href=\"https://matrix.to/#/old\"><em>edit:</em></a>" +
                " <del>fox</del> -&gt; foxies");
        });
    });
    describe("Discord Replacements", () => {
        it("processes members correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<@12345>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("foxies");
            expect(result.formattedBody).is.equal(
                "<a href=\"https://matrix.to/#/@_discord_12345:localhost\">foxies</a>");
        });
        it("ignores unknown roles", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<@&1234>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("<@&1234>");
            expect(result.formattedBody).is.equal("&lt;@&amp;1234&gt;");
        });
        it("parses known roles", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<@&123456>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("@Fox Lover");
            expect(result.formattedBody).is.equal("<span data-mx-color=\"#123456\"><strong>@Fox Lover</strong></span>");
        });
        it("parses spoilers", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("||foxies||");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("(Spoiler: foxies)");
            expect(result.formattedBody).is.equal("<span data-mx-spoiler>foxies</span>");
        });
        it("processes unknown emoji correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<:unknown:1234>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("<:unknown:1234>");
            expect(result.formattedBody).is.equal("&lt;:unknown:1234&gt;");
        });
        it("processes emoji correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<:fox:1234>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(":fox:");
            expect(result.formattedBody).is.equal(
                "<img alt=\"fox\" title=\"fox\" height=\"32\" src=\"mxc://localhost/fox\" />");
        });
        it("processes double-emoji correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<:fox:1234> <:fox:1234>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(":fox: :fox:");
            expect(result.formattedBody).is.equal(
                "<img alt=\"fox\" title=\"fox\" height=\"32\" src=\"mxc://localhost/fox\" /> " +
                "<img alt=\"fox\" title=\"fox\" height=\"32\" src=\"mxc://localhost/fox\" />");
        });
        it("processes unknown channel correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<#123>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("<#123>");
            expect(result.formattedBody).is.equal("&lt;#123&gt;");
        });
        it("processes channels correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<#12345>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("#foxies");
            expect(result.formattedBody).is.equal("<a href=\"https://matrix.to/#/#_discord_1234" +
                "_12345:localhost\">#foxies</a>");
        });
        it("processes multiple channels correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("<#12345> <#12345>");
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("#foxies #foxies");
            expect(result.formattedBody).is.equal("<a href=\"https://matrix.to/#/#_discord_1234" +
                "_12345:localhost\">#foxies</a> <a href=\"https://matrix.to/#/#_discord_1234" +
                    "_12345:localhost\">#foxies</a>");
        });
    });
    describe("InsertEmbes", () => {
        it("processes discord-specific markdown correctly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("\n\n----\nTestDescription");
            expect(result.formattedBody).is.equal("<hr><p>TestDescription</p>");
        });
        it("processes urlless embeds properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    title: "TestTitle",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("\n\n----\n##### TestTitle\nTestDescription");
            expect(result.formattedBody).is.equal("<hr><h5>TestTitle</h5><p>TestDescription</p>");
        });
        it("processes linked embeds properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    title: "TestTitle",
                    url: "testurl",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("\n\n----\n##### [TestTitle](testurl)\nTestDescription");
            expect(result.formattedBody).is.equal("<hr><h5><a href=\"testurl\">" +
                "TestTitle</a></h5><p>TestDescription</p>");
        });
        it("rejects titleless and descriptionless embeds", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("Some content...", false, false, [
                new Discord.MessageEmbed({} as any, {
                    url: "testurl",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal("Some content...");
            expect(result.formattedBody).is.equal("Some content...");
        });
        it("processes multiple embeds properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    title: "TestTitle",
                    url: "testurl",
                }),
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription2",
                    title: "TestTitle2",
                    url: "testurl2",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(`

----
##### [TestTitle](testurl)
TestDescription

----
##### [TestTitle2](testurl2)
TestDescription2`);
            expect(result.formattedBody).is.equal("<hr><h5><a href=\"testurl\">TestTitle" +
                "</a></h5><p>TestDescription</p><hr><h5><a href=\"testurl2\">" +
                "TestTitle2</a></h5><p>TestDescription2</p>");
        });
        it("inserts embeds properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("Content that goes in the message", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    title: "TestTitle",
                    url: "testurl",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(`Content that goes in the message

----
##### [TestTitle](testurl)
TestDescription`);
            expect(result.formattedBody).is.equal("Content that goes in the message<hr><h5><a " +
                "href=\"testurl\">TestTitle</a></h5><p>TestDescription</p>");
        });
        it("adds fields properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("Content that goes in the message", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    fields: [{
                        inline: false,
                        name: "fox",
                        value: "floof",
                    }],
                    title: "TestTitle",
                    url: "testurl",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(`Content that goes in the message

----
##### [TestTitle](testurl)
TestDescription
**fox**
floof`);
            expect(result.formattedBody).is.equal("Content that goes in the message<hr><h5><a" +
                " href=\"testurl\">TestTitle</a></h5><p>TestDescription</p><p><strong>fox" +
                "</strong><br>floof</p>");
        });
        it("adds images properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("Content that goes in the message", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    image: {
                        url: "http://example.com",
                    },
                    title: "TestTitle",
                    url: "testurl",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(`Content that goes in the message

----
##### [TestTitle](testurl)
TestDescription
Image: http://example.com`);
            expect(result.formattedBody).is.equal("Content that goes in the message<hr><h5>" +
                "<a href=\"testurl\">TestTitle</a></h5><p>TestDescription</p><p>Image" +
                ": <a href=\"http://example.com\">http://example.com</a></p>");
        });
        it("adds a footer properly", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("Content that goes in the message", false, false, [
                new Discord.MessageEmbed({} as any, {
                    description: "TestDescription",
                    footer: {
                        text: "footer",
                    },
                    title: "TestTitle",
                    url: "testurl",
                }),
            ]);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.body).is.equal(`Content that goes in the message

----
##### [TestTitle](testurl)
TestDescription
footer`);
            expect(result.formattedBody).is.equal("Content that goes in the message<hr>" +
                "<h5><a href=\"testurl\">TestTitle</a></h5><p>TestDescription</p><p>footer</p>");
        });
    });
    describe("Message Type", () => {
        it("sets non-bot messages as m.text", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("no bot", false);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.msgtype).is.equal("m.text");
        });
        it("sets bot messages as m.notice", async () => {
            const mp = new DiscordMessageParser();
            const msg = getMessage("a bot", true);
            const result = await mp.FormatMessage(defaultOpts, msg);
            expect(result.msgtype).is.equal("m.notice");
        });
    });
});
