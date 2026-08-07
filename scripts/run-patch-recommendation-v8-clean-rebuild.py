from pathlib import Path

path = Path('scripts/patch-recommendation-v8-clean-rebuild.py')
source = path.read_text()
old = """def block(value: str) -> str:
    lines = value.splitlines()
    if lines and not lines[0]:
        lines = lines[1:]
    if lines and not lines[-1]:
        lines = lines[:-1]
    return '\\n'.join(line.split('|', 1)[1] for line in lines) + '\\n'
"""
new = """def block(value: str) -> str:
    lines = value.splitlines()
    if lines and not lines[0]:
        lines = lines[1:]
    if lines and not lines[-1]:
        lines = lines[:-1]
    output: list[str] = []
    for line in lines:
        if '|' in line:
            output.append(line.split('|', 1)[1])
        elif output:
            output[-1] += '\\\\n' + line
        else:
            raise ValueError(f'Unmarked block line: {line!r}')
    return '\\n'.join(output) + '\\n'
"""
if source.count(old) != 1:
    raise SystemExit('Could not patch the block parser exactly once.')
corrected = source.replace(old, new, 1)
exec(compile(corrected, str(path), 'exec'), {'__name__': '__main__', '__file__': str(path)})
