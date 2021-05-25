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

export interface IDiscordEmoji {
    id: string;
    animated: boolean;
    name: string;
}

export interface IDiscordRole {
    id: string;
    name: string;
    color: number;
}

export interface IDiscordGuild {
    id: string;
    roles: {
        resolve?: (id: string) => IDiscordRole | undefined | null;
        get?: (id: string) => IDiscordRole | undefined | null;
    };
}

export interface IDiscordMessageEmbed {
    author?: {
        name?: string;
        url?: string;
        iconURL?: string;
        proxyIconURL?: string;
    } | null;
    color?: number | null;
    createdAt?: Date | null;
    description?: string | null;
    fields: {
        name: string;
        value: string;
        inline: boolean;
    }[];
    footer?: {
        text?: string | null;
        iconURL?: string | null;
        proxyIconURL?: string | null;
    } | null;
    hexColor?: string | null;
    image?: {
        url: string;
        proxyURL?: string | null;
        height?: number | null;
        width?: number | null;
    } | null;
    timestamp: number | null;
    title?: string | null;
    type: string;
    url?: string | null;
}

export interface IDiscordMessage {
    id: string;
    mention_everyone?: boolean;
    mentions?: {
        everyone: boolean;
    };
    author: {
        bot: boolean;
        id: string;
        username: string;
    };
    reference: {
        messageID: string;
    } | null;
    guild?: IDiscordGuild | null;
    content: string;
    embeds: IDiscordMessageEmbed[];
    webhookID: string;
}
