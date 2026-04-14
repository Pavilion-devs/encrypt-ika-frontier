use std::{env, process};

use liquidation_graph::{
    build_execute_graph_instruction_data, build_resolve_auction_graph, hex_encode, rust_byte_vec,
    RESOLVE_AUCTION_NUM_INPUTS,
};

#[derive(Clone, Copy)]
enum OutputFormat {
    Hex,
    Rust,
}

fn usage() -> &'static str {
    "Usage: cargo run -p liquidation_graph -- [resolve-auction] [--instruction-data] [--format hex|rust]"
}

fn main() {
    let mut format = OutputFormat::Hex;
    let mut include_instruction_data = false;

    for arg in env::args().skip(1) {
        match arg.as_str() {
            "resolve-auction" => {}
            "--instruction-data" => include_instruction_data = true,
            "--format=hex" => format = OutputFormat::Hex,
            "--format=rust" => format = OutputFormat::Rust,
            "--help" | "-h" => {
                println!("{}", usage());
                return;
            }
            other => {
                eprintln!("Unknown argument: {other}");
                eprintln!("{}", usage());
                process::exit(1);
            }
        }
    }

    let graph = build_resolve_auction_graph();
    let bytes = if include_instruction_data {
        build_execute_graph_instruction_data(&graph, RESOLVE_AUCTION_NUM_INPUTS)
    } else {
        graph
    };

    match format {
        OutputFormat::Hex => println!("{}", hex_encode(&bytes)),
        OutputFormat::Rust => println!("{}", rust_byte_vec(&bytes)),
    }
}
