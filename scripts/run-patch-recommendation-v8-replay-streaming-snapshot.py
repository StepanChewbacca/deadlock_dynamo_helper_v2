from pathlib import Path

path = Path('scripts/patch-recommendation-v8-replay-streaming-snapshot.py')
source = path.read_text()
source = source.replace(
    "    '''      await handle.write(`${JSON.stringify(row)}\\n`);''',",
    "    r'''      await handle.write(`${JSON.stringify(row)}\\n`);''',",
    1,
)
source = source.replace(
    "    '''      await writeAll(\n        handle,\n        Buffer.from(`${JSON.stringify(row)}\\n`, 'utf8'),\n      );''',",
    "    r'''      await writeAll(\n        handle,\n        Buffer.from(`${JSON.stringify(row)}\\n`, 'utf8'),\n      );''',",
    1,
)
exec(compile(source, str(path), 'exec'))
