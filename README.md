[![#discord:half-shot.uk](https://img.shields.io/matrix/discord:half-shot.uk.svg?server_fqdn=matrix.half-shot.uk&label=%23discord:half-shot.uk&logo=matrix)](https://matrix.to/#/#discord:half-shot.uk)
# matrix-discord-parser
This package is a message parser for sending messages between [Matrix](https://matrix.org/) and
[Discord](https://discordapp.com/). For that, it has two parsers: `DiscordMessageParser` and
`MatrixMessageParser`.

## DiscordMessageParser
Example code:
```ts
import { DiscordMessageParser, IDiscordMessageParserOpts } from "matrix-discord-parser";

const parser = new DiscordMessageParser();

const opts = {
    callbacks: {
        getUser: async (id: string) => null,
        getChannel: async (id: string) => null,
        getEmoji: async (name: string, animated: boolean, id: string) => null;
    },
} as IDiscordMessageParserOpts;
const message = msg; // Type Discord.Message from discord.js
const result = await parser.FormatMessage(opts, msg);
console.log(result.body); // the body of the matrix message
console.log(result.formattedBody); // the formatted body of the matrix message
console.log(result.msgtype); // the msgtype of the matrix message
```

All options of `IDiscordMessageParserOpts`:
 * `callbacks`: `IDiscordMessageParserCallbacks`, the callbacks to handle
    * `getUser`: `async (id: string) => Promise<IDiscordMessageParserEntity | null>`, resolves to
      either the information on the specified discord user or to null
    * `getChannel`: `async (id: string) => Promise<IDiscordMessageParserEntity | null>`, resolves to
      either the information of the specified discord channel or to null
    * `getEmoji`: `async (name: string, animated: boolean, id: string) => Promise<string | null>`,
      resolves to either the mxc uri of the specified discord emoji or to null

All properties of `IDiscordMessageParserEntity`:
 * `name`: `string`, the name of the entity
 * `mxid`: `string`, the resulting matrix ID of the entity

All properties of `DiscordMessageParserResult`:
 * `body`: `string`, the body of the result
 * `formattedBody`: `string`, the formatted (html) body of the result
 * `msgtype`: `string`, the matrix msgtype of the result

## MatrixMessageParser
Example code:
```ts
import { MatrixMessageParser, IMatrixMessageParserOpts } from "matrix-discord-parser";

const parser = new MatrixMessageParser();

const opts = {
    callbacks: {
        canNotifyRoom: async () => false,
        getUserId: async (mxid: string) => null,
        getChannelId: async (mxid: string) => null,
        getEmoji: async (mxc: string, name: string) => null,
        mxcUrlToHttp: async (mxc: string) => "http://example.com",
    },
    displayname: "Alice",
    determineCodeLanguage: true,
} as IMatrixMessageParserOpts;

const msg = { // raw matrix event content
    msgtype: "m.text",
    body: "**blah**",
    format: "org.matrix.custom.html",
    formatted_body: "<strong>blah</strong>",
};

const parsed = await parser.FormatMessage(opts, msg);
msg.send(parsed); // send this message to discord
```

It is expected to create the options for a message within a closure so that the callbacks can
determine if, for that particular message, the author may e.g. notify that particular room.

All options of `IMatrixMessageParserOpts`:
 * `callbacks`: `IMatrixMessageParserCallbacks`, the callbacks to handle
    * `canNotifyRoom`: `async () => Promise<boolean>`, return if that particular user can notify
      that particular room
    * `getUserId`: `async (mxid: string) => Promise<string | null>`, return the discord user ID
      given an mxid, or null
    * `getChannelId`: `async (mxid: string) => Promise<string | null>`, return the discord channel
      ID given an mxid, or null
    * `getEmoji`: `async (mxc: string, name: string) => Promise<Discord.Emoji | null>`, return a
      discord emoji given an mxc uri and a name, or null
    * `mxcUrlToHttp`: `async (mxc: string) => Promise<string>`, resolve an mxc uri to a publicly
      available http url.
 * `displayname`: `string`, the display name of the sender of the message (used for `m.emote` parsing)
 * `determineCodeLanguage`: `Boolean` (default `false`), wether the language of code-blocks should
   be auto-determined, if not specified

Returned is a discord-formatted string, ready to be sent.
