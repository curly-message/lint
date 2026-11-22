//! The part of JSON Schema 2020-12 that `fixtures/schema.json` is written
//! in. A keyword it does not know fails the file, so the schema cannot grow
//! past what is checked here.

use serde_json::Value;

const KNOWN: &[&str] = &[
    "$schema",
    "$id",
    "$defs",
    "$ref",
    "title",
    "description",
    "type",
    "enum",
    "const",
    "required",
    "properties",
    "additionalProperties",
    "unevaluatedProperties",
    "propertyNames",
    "minProperties",
    "items",
    "minItems",
    "uniqueItems",
    "contains",
    "minLength",
    "minimum",
    "pattern",
    "oneOf",
    "allOf",
];

fn pattern(pattern: &str, text: &str) -> Result<bool, String> {
    match pattern {
        r"^[0-9]+(\.[0-9]+)?$" => {
            let (whole, fraction) = text
                .split_once('.')
                .map_or((text, None), |(a, b)| (a, Some(b)));
            let digits =
                |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());

            Ok(digits(whole) && fraction.is_none_or(digits))
        }
        "^[^A-Z_]*$" => {
            Ok(!text
                .contains(|char: char| char.is_ascii_uppercase() || char == '_' || char == '\n'))
        }
        other => Err(format!("a pattern this runner does not read: {other}")),
    }
}

fn is(kind: &str, value: &Value) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "number" => value.is_number(),
        "integer" => {
            value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|n| n.fract() == 0.0)
        }
        _ => false,
    }
}

pub struct Schema<'a>(pub &'a Value);

impl Schema<'_> {
    fn resolve(&self, reference: &str) -> Result<&Value, String> {
        reference
            .strip_prefix('#')
            .and_then(|pointer| self.0.pointer(pointer))
            .ok_or_else(|| format!("a reference that leads nowhere: {reference}"))
    }

    // The members a schema names in `properties`, through its references.
    fn named<'s>(&'s self, schema: &'s Value, names: &mut Vec<&'s str>) -> Result<(), String> {
        if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
            names.extend(properties.keys().map(String::as_str));
        }

        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            self.named(self.resolve(reference)?, names)?;
        }

        for part in schema
            .get("allOf")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            self.named(part, names)?;
        }

        Ok(())
    }

    /// What of `value` breaks `schema`, each with where it stands.
    pub fn check(
        &self,
        schema: &Value,
        value: &Value,
        at: &str,
        errors: &mut Vec<String>,
    ) -> Result<(), String> {
        let schema = match schema {
            Value::Bool(true) => return Ok(()),
            Value::Bool(false) => {
                errors.push(format!("{at}: nothing is allowed here"));

                return Ok(());
            }
            Value::Object(schema) => schema,
            _ => {
                return Err(format!(
                    "{at}: a schema that is neither an object nor a boolean"
                ));
            }
        };
        let whole = Value::Object(schema.clone());

        for (keyword, rule) in schema {
            let mut fail = |what: String| errors.push(format!("{at}: {what}"));

            match keyword.as_str() {
                "$schema" | "$id" | "$defs" | "title" | "description" => {}
                "$ref" => self.check(
                    self.resolve(rule.as_str().unwrap_or_default())?,
                    value,
                    at,
                    errors,
                )?,
                "type" => {
                    if !is(rule.as_str().unwrap_or_default(), value) {
                        fail(format!("is no {rule}"));
                    }
                }
                "enum" => {
                    if !rule.as_array().is_some_and(|listed| listed.contains(value)) {
                        fail(format!("{value} is none of {rule}"));
                    }
                }
                "const" => {
                    if rule != value {
                        fail(format!("{value} is not {rule}"));
                    }
                }
                "required" => {
                    for name in rule
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                    {
                        if value.is_object() && value.get(name).is_none() {
                            fail(format!("has no `{name}`"));
                        }
                    }
                }
                "properties" => {
                    for (name, rule) in rule.as_object().into_iter().flatten() {
                        if let Some(member) = value.get(name) {
                            self.check(rule, member, &format!("{at}/{name}"), errors)?;
                        }
                    }
                }
                "additionalProperties" | "unevaluatedProperties" => {
                    let mut names = Vec::new();

                    if keyword == "unevaluatedProperties" {
                        self.named(&whole, &mut names)?;
                    } else if let Some(properties) =
                        schema.get("properties").and_then(Value::as_object)
                    {
                        names.extend(properties.keys().map(String::as_str));
                    }

                    for (name, member) in value.as_object().into_iter().flatten() {
                        if !names.contains(&name.as_str()) {
                            self.check(rule, member, &format!("{at}/{name}"), errors)?;
                        }
                    }
                }
                "propertyNames" => {
                    for name in value
                        .as_object()
                        .into_iter()
                        .flatten()
                        .map(|(name, _)| name)
                    {
                        self.check(
                            rule,
                            &Value::String(name.clone()),
                            &format!("{at}/{name} (name)"),
                            errors,
                        )?;
                    }
                }
                "minProperties" => {
                    if value
                        .as_object()
                        .is_some_and(|members| (members.len() as u64) < rule.as_u64().unwrap_or(0))
                    {
                        fail(format!("has fewer than {rule} members"));
                    }
                }
                "items" => {
                    for (index, item) in value.as_array().into_iter().flatten().enumerate() {
                        self.check(rule, item, &format!("{at}/{index}"), errors)?;
                    }
                }
                "minItems" => {
                    if value
                        .as_array()
                        .is_some_and(|items| (items.len() as u64) < rule.as_u64().unwrap_or(0))
                    {
                        fail(format!("has fewer than {rule} items"));
                    }
                }
                "uniqueItems" => {
                    let items = value.as_array().map(Vec::as_slice).unwrap_or_default();

                    if rule == &Value::Bool(true)
                        && items
                            .iter()
                            .enumerate()
                            .any(|(index, item)| items[..index].contains(item))
                    {
                        fail("lists an item twice".to_owned());
                    }
                }
                "contains" => {
                    let mut holds = false;

                    for item in value.as_array().into_iter().flatten() {
                        let mut found = Vec::new();

                        self.check(rule, item, at, &mut found)?;
                        holds |= found.is_empty();
                    }

                    if value.is_array() && !holds {
                        fail(format!("holds nothing that is {rule}"));
                    }
                }
                "minLength" => {
                    if value.as_str().is_some_and(|text| {
                        (text.chars().count() as u64) < rule.as_u64().unwrap_or(0)
                    }) {
                        fail(format!("is shorter than {rule}"));
                    }
                }
                "minimum" => {
                    if value
                        .as_f64()
                        .is_some_and(|number| number < rule.as_f64().unwrap_or(0.0))
                    {
                        fail(format!("is below {rule}"));
                    }
                }
                "pattern" => {
                    if let Some(text) = value.as_str()
                        && !pattern(rule.as_str().unwrap_or_default(), text)?
                    {
                        fail(format!("{value} does not match {rule}"));
                    }
                }
                "allOf" => {
                    for part in rule.as_array().into_iter().flatten() {
                        self.check(part, value, at, errors)?;
                    }
                }
                "oneOf" => {
                    let mut matched = 0;

                    for part in rule.as_array().into_iter().flatten() {
                        let mut found = Vec::new();

                        self.check(part, value, at, &mut found)?;
                        matched += usize::from(found.is_empty());
                    }

                    if matched != 1 {
                        // What the kind the file names breaks says more than
                        // that no alternative took it.
                        for part in rule.as_array().into_iter().flatten() {
                            let kind = self
                                .resolve(
                                    part.get("$ref").and_then(Value::as_str).unwrap_or_default(),
                                )
                                .ok()
                                .and_then(|part| part.pointer("/properties/kind/const"));

                            if kind.is_some() && kind == value.get("kind") {
                                self.check(part, value, at, errors)?;
                            }
                        }

                        errors.push(format!("{at}: matches {matched} of the alternatives"));
                    }
                }
                other => {
                    return Err(format!(
                        "{at}: a keyword this runner does not read: {other}"
                    ));
                }
            }
        }

        debug_assert!(
            schema
                .keys()
                .all(|keyword| KNOWN.contains(&keyword.as_str()))
        );

        Ok(())
    }
}
