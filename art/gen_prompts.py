"""Builds the ImageGen prompts for the AI headshot sheets.

Each sheet holds nine portraits, so 117 players need 13 sheets instead of
117 calls. The portrait descriptions are derived from the player's own
roster entry (position, quality, rarity) plus a deterministic set of
appearance traits, so every player looks different while the style stays
constant across the whole set.

Outputs:
  art/ai/prompts/gNN.txt    the prompt for one sheet
  art/ai/plan.json          sheet -> player ids, so the results can be split
"""
import io
import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'players.json')
PROMPT_DIR = os.path.join(ROOT, 'art', 'ai', 'prompts')
PLAN = os.path.join(ROOT, 'art', 'ai', 'plan.json')

# p01-p16 keep the hand-made artwork; the AI covers everyone else.
SKIP = 16

HAIR = [
    'spiky hair', 'curly hair', 'buzz cut', 'short side-parted hair',
    'messy long hair', 'bald head', 'slicked back hair', 'bowl cut',
    'short afro', 'undercut', 'middle-parted hair', 'ponytail',
    'mohawk', 'shaved sides with a topknot', 'wavy shoulder-length hair',
    'shaggy hair over the forehead', 'bald with a grey fringe',
]
SKIN = [
    'light-skinned', 'fair-skinned', 'olive-skinned', 'tan-skinned',
    'dark-skinned', 'deep brown-skinned', 'sun-tanned',
]
# Weighting matters here: an early pass gave almost every sheet the same
# "grey beard plus round glasses" face, so glasses are now rare.
FACE_YOUNG = ['clean shaven'] * 5 + ['light stubble'] * 2 + ['freckles'] * 3
FACE_MID = ['short stubble'] * 3 + ['trimmed beard'] * 3 + ['thick moustache'] * 2 + ['clean shaven'] * 2
FACE_OLD = ['full bushy beard'] * 3 + ['trimmed beard'] * 3 + ['thick moustache'] * 3 + ['goatee'] * 2 + ['grey stubble'] * 2
AGE = ['cute young boy', 'happy teenager', 'young man', 'middle-aged man', 'older man', 'elderly man']
GLASSES = ['no glasses'] * 9 + ['round glasses'] * 1 + ['square glasses'] * 1

KITS = {
    'GK': ['purple goalkeeper kit', 'teal goalkeeper kit', 'lime green goalkeeper kit',
           'bright pink goalkeeper kit', 'dark navy goalkeeper kit'],
    'DF': ['yellow and black striped kit', 'black and red kit', 'navy blue kit',
           'sky blue kit', 'white kit with red trim'],
    'MF': ['green and white kit', 'white kit with blue trim', 'grey and black kit',
           'royal blue kit', 'orange and black kit'],
    'FW': ['red and white striped kit', 'orange kit', 'crimson kit with white trim',
           'scarlet and black kit', 'golden yellow kit'],
}

STYLE = (
    'A 3x3 grid sheet of nine separate 3D cartoon football player HEADSHOT portraits, '
    'cute cheerful cartoon mobile game character, casual football game art style like '
    'Clash Royale, chibi big head proportions, big sparkling eyes and a happy smile, '
    'each portrait is a tight close-up of one character face and shoulders only, '
    'face centered and filling the whole panel, '
    'every panel has a flat pure bright green (#00FF00) chroma key background, '
    'thin white divider lines between panels, '
    'no props, no objects, no hands, no accessories, no text, no watermark, no signature, '
    'high quality game asset render'
)


FACE_YOUNG = ['clean shaven', 'light stubble', 'freckles']
FACE_MID = ['short stubble', 'trimmed beard', 'thick moustache', 'clean shaven']
FACE_OLD = ['full bushy beard', 'trimmed beard', 'thick moustache', 'goatee', 'grey stubble']


def describe(player, rng):
    """One portrait description, with features that make sense together."""
    pos = player.get('position') or 'MF'
    kit = rng.choice(KITS.get(pos, KITS['MF']))
    age = rng.choice(AGE)
    if age in ('cute young boy', 'happy teenager'):
        face = rng.choice(FACE_YOUNG)
    elif age == 'middle-aged man':
        face = rng.choice(FACE_MID)
    else:
        face = rng.choice(FACE_OLD)
    article = 'an' if age[0] in 'aeiou' else 'a'
    kit_article = 'an' if kit[0] in 'aeiou' else 'a'
    return '%s %s %s footballer with %s, %s and %s, wearing %s %s' % (
        article,
        age,
        rng.choice(SKIN),
        rng.choice(HAIR),
        face,
        rng.choice(GLASSES),
        kit_article,
        kit,
    )


def main():
    with io.open(DATA, encoding='utf-8') as fh:
        data = json.load(fh)
    players = data.get('players') if isinstance(data, dict) else data
    targets = [p for p in players if p.get('id') and _index(p['id']) > SKIP]
    targets.sort(key=lambda p: _index(p['id']))

    os.makedirs(PROMPT_DIR, exist_ok=True)
    plan = {}
    for sheet_no in range(0, len(targets), 9):
        chunk = targets[sheet_no:sheet_no + 9]
        name = 'g%02d' % (sheet_no // 9 + 1)
        lines = []
        for i, p in enumerate(chunk):
            rng = random.Random('v2-%s-%s' % (name, p['id']))
            lines.append(describe(p, rng))
        body = ', '.join(lines)
        prompt = (
            '%s. The nine players in reading order are: %s.'
            % (STYLE, body)
        )
        path = os.path.join(PROMPT_DIR, name + '.txt')
        with io.open(path, 'w', encoding='utf-8') as fh:
            fh.write(prompt)
        plan[name] = [p['id'] for p in chunk]
        print('%s -> %s' % (name, ','.join(p['id'] for p in chunk)))

    with io.open(PLAN, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(plan, ensure_ascii=False, indent=2))
    print('sheets=%d players=%d' % (len(plan), len(targets)))


def _index(pid):
    digits = ''.join(ch for ch in pid if ch.isdigit())
    return int(digits) if digits else 0


if __name__ == '__main__':
    main()
