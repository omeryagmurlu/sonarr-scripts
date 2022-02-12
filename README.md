# Various Sonarr webhook plugins

Currently there are only two plugins:

- ThemeSongs:

Downloads theme songs from plex and places them in the media folder.

- NFOThumbRemover:

Removes `<thumb>` entries from .nfo files created by sonarr. Stopgap measure till this gets released: https://github.com/jellyfin/jellyfin/pull/7286

## Usage

- Run the server (there is Dockerfile)
- Add a new post webhook in Sonarr with the address 'protocol://serverhost:serverport/sonarr/{BASE64CREDS}'
- Replace {BASE64CREDS} with the base64 encoding of your sonarr ip:port and API key.
 
For example, if you have Sonarr running on `https://sonarr.example.com` with the API key `APIKEY`, you should
take the base64 encoding of the following JSON data and use that as {BASE64CREDS}:
```json
{
    "apiKey": "APIKEY",
    "url": "https://sonarr.example.com"
}
```

### Selectively running plugins
You can also run plugins selectively. Each plugin has an identifier (ThemeSongs → theme-songs), you can use that identifier in the webhook instead of `sonarr`:
`'protocol://serverhost:serverport/theme-songs/{BASE64CREDS}'` for example.