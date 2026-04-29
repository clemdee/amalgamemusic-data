# amalgamemusic-data

Repository for managing music data for [https://amalgamemusic.com](amalgamemusic.com)

Musics in this repository are licensed under [https://creativecommons.org/licenses/by-sa/4.0/?ref=chooser-v1](CC BY-SA 4.0), except when stated otherwise.

## Installation / Usage

```sh
git clone https://github.com/clemdee/amalgamemusic-data.git
cd amalgamemusic-data
```

Place new music in the `raw` folder, update the `raw/discography.json` metadata if needed.
Commit change and push to trigger the CI/CD.

You can also manually trigger the file processing by running:
```sh
# install dependencies
pnpm install

pnpm process

# dry run (no changes made on file system)
pnpm process --dry

# remove raw files after processing (used by CI)
pnpm process --cleanup
```

Note: `process.ts` was made with the help of AI

