//! Small, tolerant parser for Valve KeyValues text format (.vdf / .acf).
//!
//! Supports quoted strings with escapes (`\n`, `\t`, `\\`, `\"`), unquoted tokens,
//! nested `{}` blocks, `//` line comments and `[$PLATFORM]` conditionals (ignored).
//! Malformed input never panics: parsing stops and whatever was read is returned.

#[derive(Debug, Clone, PartialEq)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    /// Case-insensitive lookup of the first child with `key`.
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(items) => items
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            Vdf::Str(_) => None,
        }
    }

    /// Case-insensitive lookup of a string child.
    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Vdf::as_str)
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            Vdf::Obj(_) => None,
        }
    }

    /// Children of an object (empty for strings).
    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Obj(items) => items,
            Vdf::Str(_) => &[],
        }
    }
}

#[derive(Debug, PartialEq)]
enum Tok {
    Str(String),
    Open,
    Close,
}

struct Lexer<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> Lexer<'a> {
    fn new(s: &'a str) -> Self {
        let s = s.strip_prefix('\u{feff}').unwrap_or(s);
        Lexer { chars: s.chars().peekable() }
    }

    fn next_tok(&mut self) -> Option<Tok> {
        loop {
            let c = *self.chars.peek()?;
            if c.is_whitespace() {
                self.chars.next();
                continue;
            }
            match c {
                '/' => {
                    self.chars.next();
                    if self.chars.peek() == Some(&'/') {
                        // line comment
                        for c in self.chars.by_ref() {
                            if c == '\n' {
                                break;
                            }
                        }
                        continue;
                    }
                    // a lone '/' starts an unquoted token
                    let mut s = String::from('/');
                    self.read_unquoted(&mut s);
                    return Some(Tok::Str(s));
                }
                '{' => {
                    self.chars.next();
                    return Some(Tok::Open);
                }
                '}' => {
                    self.chars.next();
                    return Some(Tok::Close);
                }
                '"' => {
                    self.chars.next();
                    let mut s = String::new();
                    while let Some(c) = self.chars.next() {
                        match c {
                            '"' => break,
                            '\\' => match self.chars.next() {
                                Some('n') => s.push('\n'),
                                Some('t') => s.push('\t'),
                                Some('r') => s.push('\r'),
                                Some('\\') => s.push('\\'),
                                Some('"') => s.push('"'),
                                Some(other) => {
                                    s.push('\\');
                                    s.push(other);
                                }
                                None => break,
                            },
                            _ => s.push(c),
                        }
                    }
                    return Some(Tok::Str(s));
                }
                '[' => {
                    // conditional like [$WIN32] — skip entirely
                    for c in self.chars.by_ref() {
                        if c == ']' {
                            break;
                        }
                    }
                    continue;
                }
                _ => {
                    let mut s = String::new();
                    self.read_unquoted(&mut s);
                    return Some(Tok::Str(s));
                }
            }
        }
    }

    fn read_unquoted(&mut self, s: &mut String) {
        while let Some(&c) = self.chars.peek() {
            if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                break;
            }
            s.push(c);
            self.chars.next();
        }
    }
}

/// Parse a whole document. The root is an object containing the top-level pairs
/// (usually one, e.g. `"libraryfolders" { ... }`).
pub fn parse(text: &str) -> Vdf {
    let mut lx = Lexer::new(text);
    Vdf::Obj(parse_obj(&mut lx, 0))
}

fn parse_obj(lx: &mut Lexer, depth: usize) -> Vec<(String, Vdf)> {
    let mut items = Vec::new();
    if depth > 64 {
        return items;
    }
    loop {
        let key = match lx.next_tok() {
            Some(Tok::Str(k)) => k,
            Some(Tok::Close) | None => return items,
            Some(Tok::Open) => {
                // stray block without key — parse and discard
                let _ = parse_obj(lx, depth + 1);
                continue;
            }
        };
        match lx.next_tok() {
            Some(Tok::Str(v)) => items.push((key, Vdf::Str(v))),
            Some(Tok::Open) => {
                let child = parse_obj(lx, depth + 1);
                items.push((key, Vdf::Obj(child)));
            }
            Some(Tok::Close) | None => return items,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested() {
        let v = parse(
            "// comment\n\"LibraryFolders\"\n{\n \"0\" { \"path\" \"C:\\\\Steam\" [$WIN32] }\n \"1\" \"D:\\\\Lib\"\n}",
        );
        let lf = v.get("libraryfolders").unwrap();
        assert_eq!(lf.get("0").unwrap().get_str("PATH"), Some("C:\\Steam"));
        assert_eq!(lf.get_str("1"), Some("D:\\Lib"));
    }

    #[test]
    fn tolerates_garbage() {
        let v = parse("\"a\" { \"b\" ");
        assert!(v.get("a").is_some());
    }
}
