type EventType = 'Download' | 'Grab' | 'Rename' | 'Test';

type _Sonarr = {
    eventType: EventType
    series: Series
    episodes: null | [Episode, ...Episode[]]
    release: Release,
    isUpgrade: boolean
    episodeFile: EpisodeFile
}

export type SonarrWebhook = Pick<_Sonarr, 'eventType' | 'series'>;
export type Grab = Pick<_Sonarr, 'eventType' | 'series' | 'episodes' | 'release'>;
export type Download = Pick<_Sonarr, 'eventType' | 'series' | 'episodes' | 'episodeFile' | 'isUpgrade'>;
export type Rename = Pick<_Sonarr, 'eventType' | 'series'>;
export type Test = Pick<_Sonarr, 'eventType' | 'series' | 'episodes'>;

export interface Series {
    id: number,
    title: string,
    path: string,
    tvdbId?: string
}

export interface Episode {
    id: number
    episodeNumber: number
    seasonNumber: number
    title: string
    airDate?: string
    airDateUtc?: string
}

export interface Release {
    quality?: string
    qualityVersion?: number
    releaseGroup?: string
    releaseTitle?: string
    indexer?: string
    size?: number
}

export interface EpisodeFile {
    id: number
    relativePath: string
    path: string
    quality?: string
    qualityVersion?: number
    releaseGroup?: string
    sceneName?: string
}

// interface Rename 
// interface Test
// interface Grab 

export const schema = {
    "$schema": "http://json-schema.org/draft-04/schema#",
    "title": "SonarrEvent",
    "description": "Sonarr Webhook Event",
    "type": "object",
    "anyOf": [
        {
            "properties": {
                "eventType": { "enum": ["Grab"] }
            },
            "required": ["eventType", "series", "episodes", "release"]
        },
        {
            "properties": {
                "eventType": { "enum": ["Download"] }
            },
            "required": ["eventType", "series", "episodes", "episodeFile", "isUpgrade"]
        },
        {
            "properties": {
                "eventType": { "enum": ["Rename"] }
            },
            "required": ["eventType", "series"]
        },
        {
            "properties": {
                "eventType": { "enum": ["Test"] }
            },
            "required": ["eventType", "series", "episodes"]
        }
    ],
    "properties":{
        "eventType": { "enum": ["Download", "Grab", "Rename", "Test"] },
        "series": {
            "type": "object",
            "required": ["id", "title", "path"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "title": { "type": "string" },
                "path": { "type": "string" },
                "tvdbId": { "type": "integer", "minimum": 1 }
            }
        },
        "episodes": {
            "type": ["array", "null"],
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["id", "episodeNumber", "seasonNumber", "title"],
                "properties": {
                    "id": { "type": "integer", "minimum": 0 },
                    "episodeNumber": { "type": "integer", "minimum": 0 },
                    "seasonNumber": { "type": "integer", "minimum": 0 },
                    "title": { "type": "string" },
                    "airDate": { "type": "string", "format": "date" },
                    "airDateUtc": { "type": "string", "format": "date-time" },
                    "quality": { "type": "string", "description": "Deprecated: will be removed in a future version" },
                    "qualityVersion": { "type": "integer", "minimum": 1, "description": "Deprecated: will be removed in a future version" },
                    "releaseGroup": { "type": "string", "description": "Deprecated: will be removed in a future version" },
                    "sceneName": { "type": "string", "description": "Deprecated: will be removed in a future version" }
                }
            }
        },
        "release": {
            "type": "object",
            "properties": {
                "quality": { "type": "string"},
                "qualityVersion": { "type": "integer", "minimum": 1 },
                "releaseGroup": { "type": "string" },
                "releaseTitle": { "type": "string" },
                "indexer": { "type": "string" },
                "size": { "type": "integer", "minimum": 0}
            }
        },
        "episodeFile": {
            "type": "object",
            "required": ["id", "relativePath", "path"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "relativePath": { "type": "string" },
                "path": { "type": "string" },
                "quality": { "type": "string" },
                "qualityVersion": { "type": "integer", "minimum": 1 },
                "releaseGroup": { "type": "string" },
                "sceneName": { "type": "string" }
            }
        },
        "isUpgrade": { "type": "boolean" }
    }
};