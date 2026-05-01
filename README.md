# amalgamemusic-data

Repository for managing music assets for [amalgamemusic.com]([amalgamemusic.com](https://amalgamemusic.com))

Music in this repository is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/?ref=chooser-v1)

## Installation / Usage

```sh
git clone https://github.com/clemdee/amalgamemusic-data.git
cd amalgamemusic-data
```

Place new music in the `raw` folder, update the `raw/discography.json` metadata if needed.

You can also manually trigger the file processing by running:
```sh
# install dependencies
pnpm install

# Process files
pnpm run process
pnpm run process --dry # dry run (no changes made on file system)
pnpm run process --cleanup # remove raw files after processing

# Process files and commit
pnpm run commit

# Process files, commit, and deploy
pnpm run publish
```

> [!WARNING]
> Commits made in the prod branch will trigger the deploy CI.

> [!NOTE]
> Scripts were made with the help of AI

