use super::*;

#[test]
fn xml_escape_replaces_entities() {
    let raw = "<tag>\"&'";
    let escaped = xml_escape(raw);
    assert!(escaped.contains("&lt;tag&gt;"));
    assert!(escaped.contains("&quot;"));
    assert!(escaped.contains("&amp;"));
    assert!(escaped.contains("&apos;"));
}

#[test]
fn command_line_quotes_the_executable_and_appends_args() {
    let exe = Path::new("/opt/open human/openhuman-core");
    assert_eq!(
        command_line(exe, &["run".to_string()]),
        "\"/opt/open human/openhuman-core\" run"
    );
    assert_eq!(command_line(exe, &[]), "\"/opt/open human/openhuman-core\"");
}
