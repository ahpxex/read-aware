//! One bundled format catalog drives native handler registration on both OSes.
pub(super) struct BookType {
    pub extensions: Vec<String>,
    pub legacy_class: String,
    pub mime: String,
    pub description: String,
}

pub(super) fn book_types() -> Vec<BookType> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
        .expect("compile-time Tauri configuration");
    config["bundle"]["fileAssociations"]
        .as_array()
        .expect("book associations")
        .iter()
        .map(|entry| BookType {
            extensions: entry["ext"]
                .as_array()
                .expect("extensions")
                .iter()
                .map(|ext| ext.as_str().expect("extension").to_owned())
                .collect(),
            legacy_class: entry["name"].as_str().expect("legacy class").into(),
            mime: entry["mimeType"].as_str().expect("MIME type").into(),
            description: entry["description"].as_str().expect("description").into(),
        })
        .collect()
}
