//! Title/author guesses from a book's file name — the fallback when a format
//! carries no extractable metadata. A port of the web app's
//! `book-file-name.ts` (the shelf placeholder and metadata enrichment keep
//! using that copy); `import_cases/import_file_name_cases.json`, generated from
//! it, pins both to the same answers.
//!
//! JavaScript's `\w`, `\d` and `\b` are ASCII-only, so the patterns below
//! spell those classes out instead of using Rust's Unicode-aware ones.
use regex::Regex;
use std::sync::LazyLock;

pub struct NameGuess {
    pub title: String,
    pub author: String,
}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("file-name pattern compiles")
}

/// Known book extensions, stripped repeatedly so "book.fb2.zip" fully bares.
static EXTENSION: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"(?i)\.(?:pdf|epub|mobi|azw3?|kf8|prc|fb2|fbz|zip|cbz|cbr|txt|text|html?|xhtml)$")
});

/// A domain-looking token ("www.site.com", "z-lib.org/..."), wherever it sits.
static DOMAIN_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*\.(?:com|net|org|cc|co|me|io|info|xyz|top|vip|cn|ru|la|site|club|pub|app|link)(?:/[a-zA-Z0-9_/-]*)?",
    )
});

/// Well-known distribution sources, with or without their TLD.
static JUNK_SOURCE: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)z-?lib(?:rary)?|libgen|annas?-?archive|oceanofpdf|epubw|jiumodiary|bookzz|b-?ok|sanet|salttiger|epublibre",
    )
});

/// A bracketed group that is release noise rather than title.
static JUNK_WORD: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)^(?:e-?book|pdf|epub|mobi|azw3?|kindle|retail|scan(?:ned)?|ocr|fixed|final|complete|正版|完整版|精校(?:版)?|电子书|扫描版|文字版|无水印|高清(?:版)?)$",
    )
});

static YEAR_ONLY: LazyLock<Regex> = LazyLock::new(|| regex(r"^(?:19|20)[0-9]{2}$"));

/// Pure counters: "(1)" download dupes, "v2", stray digit runs.
static COUNTER_ONLY: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^[0-9\s._\-v]+$"));

static BRACKET_GROUPS: LazyLock<[Regex; 4]> = LazyLock::new(|| {
    [
        regex(r"\(([^()]*)\)"),
        regex(r"\[([^\[\]]*)\]"),
        regex(r"【([^【】]*)】"),
        regex(r"（([^（）]*)）"),
    ]
});

static TRAILING_VERSION: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)(?-u:\b)v[0-9]+(?:\.[0-9]+)*\s*$"));
static UNDERSCORES: LazyLock<Regex> = LazyLock::new(|| regex(r"_+"));
static WHITESPACE: LazyLock<Regex> = LazyLock::new(|| regex(r"\s+"));
static DANGLING: LazyLock<Regex> = LazyLock::new(|| regex(r"^[\s\-–—·.]+|[\s\-–—·.]+$"));
static AUTHOR_SPLIT: LazyLock<Regex> = LazyLock::new(|| regex(r"\s+-\s+"));
static WORD: LazyLock<Regex> = LazyLock::new(|| regex(r"[a-zA-Z0-9_]\S*"));

/// JavaScript's `String.prototype.trim` also strips the BOM.
fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

fn is_junk_group(content: &str) -> bool {
    let inner = js_trim(content);
    inner.is_empty()
        || DOMAIN_TOKEN.is_match(inner)
        || JUNK_SOURCE.is_match(inner)
        || YEAR_ONLY.is_match(inner)
        || COUNTER_ONLY.is_match(inner)
        || JUNK_WORD.is_match(inner)
}

fn strip_distribution_junk(value: &str) -> String {
    let mut out = value.to_owned();
    for group in BRACKET_GROUPS.iter() {
        out = group
            .replace_all(&out, |captures: &regex::Captures| {
                if is_junk_group(&captures[1]) {
                    " ".to_owned()
                } else {
                    captures[0].to_owned()
                }
            })
            .into_owned();
    }
    out = DOMAIN_TOKEN.replace_all(&out, " ").into_owned();
    // A trailing version tag ("v2", "v1.3") is release noise; inner ones stay.
    TRAILING_VERSION.replace(&out, " ").into_owned()
}

fn strip_book_extensions(file_name: &str) -> String {
    let mut out = file_name.to_owned();
    while EXTENSION.is_match(&out) {
        out = EXTENSION.replace(&out, "").into_owned();
    }
    out
}

fn to_title_case(value: &str) -> String {
    WORD.replace_all(value, |captures: &regex::Captures| {
        let segment = &captures[0];
        let mut chars = segment.chars();
        match chars.next() {
            Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
            None => String::new(),
        }
    })
    .into_owned()
}

fn normalize_part(value: &str) -> String {
    let spaced = UNDERSCORES.replace_all(value, " ");
    let collapsed = WHITESPACE.replace_all(&spaced, " ");
    // Dangling separators left where junk was cut out.
    let bare = DANGLING.replace_all(&collapsed, "");
    let trimmed = js_trim(&bare);
    if trimmed.is_empty() {
        return String::new();
    }
    to_title_case(trimmed)
}

/// "Title - Author" is the dominant naming convention; everything before the
/// first " - " is the title, the rest the author. Junk is stripped first so a
/// site tag glued to either side never pollutes the split.
pub fn parse_file_name(file_name: &str) -> NameGuess {
    let stripped = strip_distribution_junk(&strip_book_extensions(file_name));
    let mut base = UNDERSCORES.replace_all(&stripped, " ").into_owned();
    // Dots as word separators ("Deep.Learning.with.Python") — only when the
    // name has no real spaces, so "Dr. Strange" keeps its dot.
    if !js_trim(&base)
        .chars()
        .any(|c| c.is_whitespace() || c == '\u{feff}')
        && base.matches('.').count() >= 2
    {
        base = base.replace('.', " ");
    }
    let mut parts = AUTHOR_SPLIT.split(&base);
    let raw_title = parts.next().unwrap_or("");
    let raw_author = parts.collect::<Vec<_>>().join(" - ");
    let title = normalize_part(raw_title);
    let author = normalize_part(&raw_author);
    NameGuess {
        title: if title.is_empty() {
            "Untitled".to_owned()
        } else {
            title
        },
        author: if author.is_empty() {
            "Unknown author".to_owned()
        } else {
            author
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_parse_like_the_web_placeholder() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("import_cases/import_file_name_cases.json")).unwrap();
        let mut failures = Vec::new();
        for case in &cases {
            let name = case["fileName"].as_str().unwrap();
            let guess = parse_file_name(name);
            if guess.title != case["title"].as_str().unwrap()
                || guess.author != case["author"].as_str().unwrap()
            {
                failures.push(format!(
                    "{name:?}: got ({:?}, {:?}), want ({}, {})",
                    guess.title, guess.author, case["title"], case["author"]
                ));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }
}
