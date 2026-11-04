"""文档约束:用词规则与相对链接,规则见 docs/README.md。"""

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHASE_TERMS = re.compile(
    r"(?<![A-Za-z0-9_])[PF][0-9][a-f]?\+?(?![A-Za-z0-9_])|阶段|里程碑|一期|二期|三期"
)
TIMELINE_TERMS = re.compile(r"本轮|早期|修订|历史")
RULE_STATEMENT = re.compile(r"不使用阶段代号|也不写")
LINK = re.compile(r"\]\(([^)\s]+)\)|<a href=\"([^\"]+)\"")
CODE_DIRS = ("src", "py_modules", "player/src", "provider/src", "wire/src", "tests")
CODE_SUFFIXES = {".ts", ".tsx", ".mjs", ".py", ".rs"}


def docs():
    files = [ROOT / "AGENTS.md", ROOT / "README.md", ROOT / "README_EN.md"]
    files += sorted((ROOT / "docs").rglob("*.md"))
    files += sorted((ROOT / ".agents/skills").rglob("*.md"))
    return files


def hits(path, pattern, skip=None):
    text = path.read_text(encoding="utf-8")
    return [
        f"{path.relative_to(ROOT)}:{number}: {line.strip()[:80]}"
        for number, line in enumerate(text.splitlines(), 1)
        if pattern.search(line) and not (skip and skip.search(line))
    ]


class DocRules(unittest.TestCase):
    def test_no_phase_terms(self):
        found = [
            hit
            for path in docs()
            for hit in hits(path, PHASE_TERMS, skip=RULE_STATEMENT)
        ]
        self.assertEqual(found, [])

    def test_no_phase_codes_in_code_comments(self):
        code_only = re.compile(r"(?<![A-Za-z0-9_])P[0-9][a-f]?(?![A-Za-z0-9_])")
        found = []
        for directory in CODE_DIRS:
            for path in sorted((ROOT / directory).rglob("*")):
                if path.suffix in CODE_SUFFIXES and path != pathlib.Path(__file__).resolve():
                    found += hits(path, code_only)
        self.assertEqual(found, [])

    def test_design_and_plan_describe_current_state(self):
        found = []
        for directory in ("docs/design", "docs/plan"):
            for path in sorted((ROOT / directory).rglob("*.md")):
                found += hits(path, TIMELINE_TERMS)
        self.assertEqual(found, [])

    def test_relative_links_resolve(self):
        broken = []
        for path in docs():
            for match in LINK.finditer(path.read_text(encoding="utf-8")):
                target = (match.group(1) or match.group(2)).split("#")[0]
                if not target or re.match(r"[a-z]+:|//", target):
                    continue
                if not (path.parent / target).exists():
                    broken.append(f"{path.relative_to(ROOT)} -> {target}")
        self.assertEqual(broken, [])


if __name__ == "__main__":
    unittest.main()
