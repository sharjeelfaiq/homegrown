#!/usr/bin/env python3
"""Find CSS class rules that no component uses, and classes no CSS defines.

Written during the Tailwind migration, for one specific failure that has
already happened once: porting a component to utilities and deleting its own
rules, while a *contextual* rule elsewhere still targeted the old class.
`.compose-bar .generate { margin-left: auto }` survived the port of
GenerateButton, matched nothing afterwards, and silently stopped anchoring the
button to the right of the compose row. Nothing failed. The build was green.

Two directions, both worth knowing:

  orphan rule   a selector in the stylesheets that matches no className in
                any .tsx.
                Usually dead weight; occasionally a lost behaviour, as above.
  missing rule  a className in a .tsx that no CSS file defines and Tailwind
                does not generate. Usually a typo or a half-finished port.

This is deliberately approximate. It cannot see dynamic class names, and it
does not try: anything built by string concatenation is reported under
"unresolvable" for a human to judge rather than guessed at.

    python scripts/check_orphan_css.py

Exits non-zero only on orphan rules, which are the actionable direction.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend" / "src"
CSS_FILES = [FRONTEND / "index.css", FRONTEND / "styles" / "tokens.css"]

# Class selectors in the stylesheet, e.g. `.foo`, `.foo:hover`, `.a .b`.
SELECTOR_CLASS = re.compile(r"\.(-?[_a-zA-Z][\w-]*)")
# className="..." and className={`...`} -- the literal parts only.
CLASSNAME_ATTR = re.compile(r"className=(?:\"([^\"]*)\"|\{`([^`]*)`\}|\{'([^']*)'\})")
# Any bare quoted string that looks like it could be a class list, for the
# ternary and template cases: className={x ? 'foo' : 'bar'}, and the
# conditional fragments inside a template literal: `base${on ? ' is-on' : ''}`.
# The leading \s* matters -- those fragments start with a space, and requiring
# a letter first made every one of them read as an unused CSS class.
QUOTED = re.compile(r"['\"`](\s*[A-Za-z][\w\s-]*)['\"`]")

# Selectors that are never written in a className: element/state hooks, and
# the pseudo-class-only utilities.
IGNORE = {"mono"}


def css_classes() -> dict[str, set[Path]]:
    out: dict[str, set[Path]] = {}
    for path in CSS_FILES:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        # Strip comments so prose mentions of ".block-input" do not count.
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        # Only look at selector text: everything before each `{`.
        for block in re.finditer(r"([^{}]+)\{", text):
            sel = block.group(1)
            if "@" in sel:  # at-rules, @utility, @media, @keyframes
                continue
            for name in SELECTOR_CLASS.findall(sel):
                out.setdefault(name, set()).add(path)
    return out


def tsx_classes() -> tuple[set[str], list[str]]:
    used: set[str] = set()
    unresolvable: list[str] = []
    for path in sorted(FRONTEND.rglob("*.tsx")):
        text = path.read_text(encoding="utf-8")
        for m in CLASSNAME_ATTR.finditer(text):
            literal = next(g for g in m.groups() if g is not None)
            if "${" in literal:
                unresolvable.append(f"{path.relative_to(ROOT)}: {literal.strip()[:70]}")
                for frag in re.split(r"\$\{[^}]*\}", literal):
                    used.update(frag.split())
            else:
                used.update(literal.split())
        # Class names living in ternaries / variables rather than the attribute.
        for m in QUOTED.finditer(text):
            used.update(m.group(1).split())
    return used, unresolvable


# A class name written flush against a template interpolation:
#     `result-bar${showTicks ? ' has-ticks' : ''}`
# Tailwind's scanner splits candidates on whitespace and quotes, not on `${`,
# so the candidate it extracts is the literal text `result-bar${showTicks`,
# which matches no utility and emits nothing. The class silently does not
# exist. This is not theoretical -- it shipped: the in-progress voiceover's
# progress bar lost its height and background and rendered as nothing, while
# `has-ticks` in the same template worked fine because it sits in its own
# quoted string.
#
# Always a bug, never intentional. Put a space before the `${`, or build the
# list as an array and .filter(Boolean).join(' ').
GLUED_CLASS = re.compile(r"[A-Za-z0-9_:./%\[\]-]+\$\{")


def glued_classes() -> list[str]:
    out: list[str] = []
    for path in sorted(FRONTEND.rglob("*.tsx")):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "className" not in line and "`" not in line:
                continue
            for m in GLUED_CLASS.finditer(line):
                token = m.group()[:-2]
                # Only care inside template literals that look like class lists.
                if "`" in line or "className" in line:
                    out.append(f"{path.relative_to(ROOT)}:{lineno}  {token}${{…}}")
    return out


def main() -> int:
    defined = css_classes()
    used, unresolvable = tsx_classes()
    glued = glued_classes()

    orphans = {
        name: paths
        for name, paths in defined.items()
        if name not in used and name not in IGNORE
    }

    print(f"css classes defined: {len(defined)}")
    print(f"classes used in tsx: {len(used)}")

    if unresolvable:
        print(f"\n{len(unresolvable)} dynamic className(s), not checked:")
        for u in unresolvable:
            print(f"  {u}")

    if glued:
        print(f"\n{len(glued)} class name(s) glued to a template interpolation:\n")
        for g in glued:
            print(f"  {g}")
        print(
            "\nTailwind will not emit these. Its scanner splits candidates on\n"
            "whitespace and quotes, not on `${`, so it sees the literal text\n"
            "`name${expr` and matches nothing -- the class silently does not\n"
            "exist, and the build stays green. Put a space before the `${`, or\n"
            "build the list as an array and .filter(Boolean).join(' ')."
        )
        return 1

    if orphans:
        print(f"\n{len(orphans)} CSS class(es) that no component uses:\n")
        for name, paths in sorted(orphans.items()):
            where = ", ".join(sorted(p.relative_to(ROOT).as_posix() for p in paths))
            print(f"  .{name}")
            print(f"      {where}")
        print(
            "\nEach is either dead weight to delete, or -- the dangerous case --\n"
            "a behaviour that was lost when its component was ported. Check what\n"
            "the rule DID before deleting it."
        )
        return 1

    print("\nOK: every CSS class is used by some component.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
