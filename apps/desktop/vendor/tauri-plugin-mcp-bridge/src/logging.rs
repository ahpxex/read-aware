pub fn mcp_log_info(scope: &str, msg: &str) {
    println!("[MCP][{scope}][INFO] {msg}");
}

pub fn mcp_log_error(scope: &str, msg: &str) {
    eprintln!("[MCP][{scope}][ERROR] {msg}");
}
