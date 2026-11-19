//! Read-only directory capabilities. Ambient authority is used only at the host picker boundary.
use super::{invalid, missing, ResourceFiles, ResourceInfo, LIFETIME};
use crate::error::CommandError;
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Mutex, time::Instant};
use tauri::Manager;

struct Grant {
    dir: Dir,
    created: Instant,
}
#[derive(Default)]
pub struct DirectoryGrants(Mutex<HashMap<String, Grant>>);
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    relative_path: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    name: String,
    relative_path: String,
    kind: &'static str,
    size: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    entries: Vec<Item>,
    next_cursor: Option<String>,
    omitted_count: usize,
}

fn path(value: &str, root: bool) -> Result<&str, CommandError> {
    if value.is_empty() && root {
        return Ok(".");
    }
    if value.is_empty()
        || value.len() > 4096
        || value.split('/').count() > 32
        || value
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
        || value
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(invalid("Expected a bounded relative directory path"));
    }
    Ok(value)
}
fn get<'a>(grants: &'a mut HashMap<String, Grant>, id: &str) -> Result<&'a Dir, CommandError> {
    grants.retain(|_, g| g.created.elapsed() < LIFETIME);
    Ok(&grants.get(id).ok_or_else(missing)?.dir)
}
fn acquire(grants: &mut HashMap<String, Grant>, selected: &str) -> Result<String, CommandError> {
    grants.retain(|_, g| g.created.elapsed() < LIFETIME);
    if grants.len() >= 16 {
        return Err(super::quota());
    }
    let dir = Dir::open_ambient_dir(selected, cap_std::ambient_authority())?;
    let id = uuid::Uuid::new_v4().to_string();
    grants.insert(
        id.clone(),
        Grant {
            dir,
            created: Instant::now(),
        },
    );
    Ok(id)
}
fn listing(dir: &Dir, id: &str, query: Query) -> Result<Page, CommandError> {
    let relative = query.relative_path.unwrap_or_default();
    let child = dir.open_dir(path(&relative, true)?)?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(invalid("Directory page limit must be 1..100"));
    }
    let mut entries = Vec::new();
    let mut omitted_count = 0;
    for (index, entry) in child.entries()?.enumerate() {
        if index >= 5000 {
            return Err(CommandError::new(
                "ui/unavailable",
                "Directory exceeds 5000-entry scan budget",
            ));
        }
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            omitted_count += 1;
            continue;
        };
        let relative_path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let kind = entry.file_type()?;
        if path(&relative_path, false).is_err()
            || name.len() > 256
            || (!kind.is_dir() && !kind.is_file())
        {
            omitted_count += 1;
            continue;
        }
        // Metadata is a listing hint, not a promise that a later read has the same bytes.
        let size = if kind.is_file() {
            Some(entry.metadata()?.len())
        } else {
            None
        };
        entries.push(Item {
            name,
            relative_path,
            kind: if kind.is_dir() { "directory" } else { "file" },
            size,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(
            id,
            &relative,
            &entries,
            omitted_count
        ))?)
    );
    let offset = if let Some(cursor) = query.cursor {
        if cursor.len() > 90 {
            return Err(invalid("Invalid directory cursor"));
        }
        let prefix = format!("dir1:{fingerprint}:");
        let Some(value) = cursor.strip_prefix(&prefix) else {
            return Err(CommandError::new(
                "ui/superseded",
                "Directory listing changed; restart from the first page",
            ));
        };
        let parsed: usize = value
            .parse()
            .map_err(|_| invalid("Invalid directory cursor"))?;
        if parsed.to_string() != value || parsed == 0 || parsed >= entries.len() {
            return Err(invalid("Invalid directory cursor"));
        }
        parsed
    } else {
        0
    };
    let end = (offset + limit).min(entries.len());
    let next_cursor = (end < entries.len()).then(|| format!("dir1:{fingerprint}:{end}"));
    Ok(Page {
        entries: entries.into_iter().skip(offset).take(limit).collect(),
        next_cursor,
        omitted_count,
    })
}
fn file(dir: &Dir, relative: &str) -> Result<std::fs::File, CommandError> {
    let relative = path(relative, false)?;
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true);
    // A file replaced by a FIFO must not block the host's resource queue indefinitely.
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = dir.open_with(relative, &options)?;
    if !file.metadata()?.is_file() {
        return Err(invalid("Directory resource must be a regular file"));
    }
    Ok(file.into_std())
}

#[tauri::command]
pub async fn resource_open_directory(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, CommandError> {
    crate::storage::blocking("resource_open_directory", move || {
        acquire(&mut *app.state::<DirectoryGrants>().0.lock()?, &path)
    })
    .await
}
#[tauri::command]
pub async fn resource_list_directory(
    app: tauri::AppHandle,
    id: String,
    query: Query,
) -> Result<Page, CommandError> {
    crate::storage::blocking("resource_list_directory", move || {
        let state = app.state::<DirectoryGrants>();
        let mut grants = state.0.lock()?;
        listing(get(&mut grants, &id)?, &id, query)
    })
    .await
}
#[tauri::command]
pub async fn resource_open_directory_file(
    app: tauri::AppHandle,
    id: String,
    relative_path: String,
) -> Result<ResourceInfo, CommandError> {
    crate::storage::blocking("resource_open_directory_file", move || {
        let source = {
            let state = app.state::<DirectoryGrants>();
            let mut grants = state.0.lock()?;
            file(get(&mut grants, &id)?, &relative_path)?
        };
        let scratch = super::scratch_dir(&app)?;
        super::insert(
            &mut *app.state::<ResourceFiles>().0.lock()?,
            &scratch,
            Some(source),
        )
    })
    .await
}
#[tauri::command]
pub async fn resource_release_directory(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), CommandError> {
    crate::storage::blocking("resource_release_directory", move || {
        app.state::<DirectoryGrants>().0.lock()?.remove(&id);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_grants_page_copy_and_revoke_without_ambient_paths() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("child")).unwrap();
        std::fs::write(root.path().join("a.txt"), "before").unwrap();
        let mut grants = HashMap::new();
        let id = acquire(&mut grants, root.path().to_str().unwrap()).unwrap();
        let page = listing(
            get(&mut grants, &id).unwrap(),
            &id,
            Query {
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.entries[0].name, "a.txt");
        let cursor = page.next_cursor.unwrap();
        let next = listing(
            get(&mut grants, &id).unwrap(),
            &id,
            Query {
                cursor: Some(cursor.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(next.entries[0].kind, "directory");
        let mut snapshots = HashMap::new();
        let scratch = tempfile::tempdir().unwrap();
        let copied = super::super::insert(
            &mut snapshots,
            scratch.path(),
            Some(file(get(&mut grants, &id).unwrap(), "a.txt").unwrap()),
        )
        .unwrap();
        std::fs::write(root.path().join("a.txt"), "after changed").unwrap();
        assert_eq!(
            super::super::read(&mut snapshots, &copied.id, 0, 100).unwrap(),
            b"before"
        );
        assert!(listing(
            get(&mut grants, &id).unwrap(),
            &id,
            Query {
                cursor: Some(cursor),
                ..Default::default()
            }
        )
        .is_err());
        for bad in [
            "../escape",
            "/etc/passwd",
            "a/../b",
            "a\\b",
            "C:bad",
            "./a.txt",
        ] {
            assert!(file(get(&mut grants, &id).unwrap(), bad).is_err());
        }
        grants.remove(&id);
        assert!(get(&mut grants, &id).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn directory_capabilities_reject_symlink_escape_and_special_files() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), "private").unwrap();
        symlink(outside.path(), root.path().join("escape")).unwrap();
        let dir = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        assert!(file(&dir, "escape/secret").is_err());
        assert!(listing(
            &dir,
            "owner",
            Query {
                relative_path: Some("escape".into()),
                ..Default::default()
            }
        )
        .is_err());
        assert_eq!(
            listing(&dir, "owner", Query::default())
                .unwrap()
                .omitted_count,
            1
        );
        assert!(file(&dir, "escape").is_err());
    }
}
