pub const EXECUTE_GRAPH_DISCRIMINATOR: u8 = 4;
pub const RESOLVE_AUCTION_NUM_INPUTS: u8 = 3;
pub const RESOLVE_AUCTION_NUM_OUTPUTS: u8 = 2;
pub const POSITION_RESOLVE_GRAPH_MAX_LEN: usize = 512;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphNodeKind {
    Input = 0,
    Constant = 2,
    Op = 3,
    Output = 4,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FheType {
    EUint64 = 4,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FheOperation {
    IsGreaterOrEqual = 44,
    Select = 60,
}

#[derive(Default)]
struct GraphBuilder {
    nodes: Vec<[u8; 9]>,
    constants: Vec<u8>,
    num_inputs: u8,
    num_constants: u8,
    num_ops: u8,
    num_outputs: u8,
}

impl GraphBuilder {
    fn add_input(&mut self, fhe_type: FheType) -> u16 {
        self.num_inputs += 1;
        self.push_node(
            GraphNodeKind::Input,
            0,
            fhe_type as u8,
            0xFFFF,
            0xFFFF,
            0xFFFF,
        )
    }

    fn add_constant_u64(&mut self, value: u64) -> u16 {
        let offset = self.constants.len() as u16;
        self.constants.extend_from_slice(&value.to_le_bytes());
        self.num_constants += 1;
        self.push_node(
            GraphNodeKind::Constant,
            0,
            FheType::EUint64 as u8,
            offset,
            0xFFFF,
            0xFFFF,
        )
    }

    fn add_binary_op(
        &mut self,
        op: FheOperation,
        fhe_type: FheType,
        input_a: u16,
        input_b: u16,
    ) -> u16 {
        self.num_ops += 1;
        self.push_node(
            GraphNodeKind::Op,
            op as u8,
            fhe_type as u8,
            input_a,
            input_b,
            0xFFFF,
        )
    }

    fn add_select(&mut self, condition: u16, if_true: u16, if_false: u16) -> u16 {
        self.num_ops += 1;
        self.push_node(
            GraphNodeKind::Op,
            FheOperation::Select as u8,
            FheType::EUint64 as u8,
            condition,
            if_true,
            if_false,
        )
    }

    fn add_output(&mut self, source: u16) -> u16 {
        self.num_outputs += 1;
        self.push_node(
            GraphNodeKind::Output,
            0,
            FheType::EUint64 as u8,
            source,
            0xFFFF,
            0xFFFF,
        )
    }

    fn push_node(
        &mut self,
        kind: GraphNodeKind,
        op_type: u8,
        fhe_type: u8,
        input_a: u16,
        input_b: u16,
        input_c: u16,
    ) -> u16 {
        let index = self.nodes.len() as u16;
        let mut node = [0u8; 9];
        node[0] = kind as u8;
        node[1] = op_type;
        node[2] = fhe_type;
        node[3..5].copy_from_slice(&input_a.to_le_bytes());
        node[5..7].copy_from_slice(&input_b.to_le_bytes());
        node[7..9].copy_from_slice(&input_c.to_le_bytes());
        self.nodes.push(node);
        index
    }

    fn serialize(self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(8 + (self.nodes.len() * 9) + self.constants.len());
        bytes.push(1);
        bytes.push(self.num_inputs);
        bytes.push(0);
        bytes.push(self.num_constants);
        bytes.push(self.num_ops);
        bytes.push(self.num_outputs);
        bytes.extend_from_slice(&(self.constants.len() as u16).to_le_bytes());
        for node in self.nodes {
            bytes.extend_from_slice(&node);
        }
        bytes.extend_from_slice(&self.constants);
        bytes
    }
}

pub fn build_resolve_auction_graph() -> Vec<u8> {
    let mut graph = GraphBuilder::default();

    let bid_a = graph.add_input(FheType::EUint64);
    let bid_b = graph.add_input(FheType::EUint64);
    let bid_c = graph.add_input(FheType::EUint64);

    let idx_zero = graph.add_constant_u64(0);
    let idx_one = graph.add_constant_u64(1);
    let idx_two = graph.add_constant_u64(2);

    let bid_a_ge_bid_b = graph.add_binary_op(
        FheOperation::IsGreaterOrEqual,
        FheType::EUint64,
        bid_a,
        bid_b,
    );
    let winner_ab = graph.add_select(bid_a_ge_bid_b, idx_zero, idx_one);
    let max_ab = graph.add_select(bid_a_ge_bid_b, bid_a, bid_b);
    let max_ab_ge_bid_c = graph.add_binary_op(
        FheOperation::IsGreaterOrEqual,
        FheType::EUint64,
        max_ab,
        bid_c,
    );
    let winner = graph.add_select(max_ab_ge_bid_c, winner_ab, idx_two);
    let winning_bid = graph.add_select(max_ab_ge_bid_c, max_ab, bid_c);

    graph.add_output(winner);
    graph.add_output(winning_bid);

    graph.serialize()
}

pub fn build_execute_graph_instruction_data(graph_data: &[u8], num_inputs: u8) -> Vec<u8> {
    let graph_len = u16::try_from(graph_data.len()).expect("graph exceeds u16 length");
    let mut ix = Vec::with_capacity(1 + 2 + graph_data.len() + 1);
    ix.push(EXECUTE_GRAPH_DISCRIMINATOR);
    ix.extend_from_slice(&graph_len.to_le_bytes());
    ix.extend_from_slice(graph_data);
    ix.push(num_inputs);
    ix
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0F) as usize] as char);
    }
    out
}

pub fn rust_byte_vec(bytes: &[u8]) -> String {
    let body = bytes
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    format!("vec![{body}]")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node_at(bytes: &[u8], index: usize) -> [u8; 9] {
        let start = 8 + (index * 9);
        let end = start + 9;
        let mut node = [0u8; 9];
        node.copy_from_slice(&bytes[start..end]);
        node
    }

    fn le_u16(lo: u8, hi: u8) -> u16 {
        u16::from_le_bytes([lo, hi])
    }

    #[test]
    fn resolve_auction_graph_matches_expected_shape() {
        let graph = build_resolve_auction_graph();

        assert_eq!(graph[0], 1, "version");
        assert_eq!(graph[1], 3, "num_inputs");
        assert_eq!(graph[2], 0, "num_plaintext_inputs");
        assert_eq!(graph[3], 3, "num_constants");
        assert_eq!(graph[4], 6, "num_ops");
        assert_eq!(graph[5], 2, "num_outputs");
        assert_eq!(le_u16(graph[6], graph[7]), 24, "constants_len");
        assert_eq!(graph.len(), 158, "serialized graph length");
        assert!(
            graph.len() <= POSITION_RESOLVE_GRAPH_MAX_LEN,
            "graph must fit inside Position::resolve_graph"
        );

        let input_a = node_at(&graph, 0);
        assert_eq!(input_a[0], GraphNodeKind::Input as u8);
        assert_eq!(input_a[2], FheType::EUint64 as u8);

        let ge_ab = node_at(&graph, 6);
        assert_eq!(ge_ab[0], GraphNodeKind::Op as u8);
        assert_eq!(ge_ab[1], FheOperation::IsGreaterOrEqual as u8);
        assert_eq!(le_u16(ge_ab[3], ge_ab[4]), 0);
        assert_eq!(le_u16(ge_ab[5], ge_ab[6]), 1);

        let winner_ab = node_at(&graph, 7);
        assert_eq!(winner_ab[1], FheOperation::Select as u8);
        assert_eq!(le_u16(winner_ab[3], winner_ab[4]), 6);
        assert_eq!(le_u16(winner_ab[5], winner_ab[6]), 3);
        assert_eq!(le_u16(winner_ab[7], winner_ab[8]), 4);

        let max_ab = node_at(&graph, 8);
        assert_eq!(max_ab[1], FheOperation::Select as u8);
        assert_eq!(le_u16(max_ab[3], max_ab[4]), 6);
        assert_eq!(le_u16(max_ab[5], max_ab[6]), 0);
        assert_eq!(le_u16(max_ab[7], max_ab[8]), 1);

        let ge_max_c = node_at(&graph, 9);
        assert_eq!(ge_max_c[1], FheOperation::IsGreaterOrEqual as u8);
        assert_eq!(le_u16(ge_max_c[3], ge_max_c[4]), 8);
        assert_eq!(le_u16(ge_max_c[5], ge_max_c[6]), 2);

        let winner = node_at(&graph, 10);
        assert_eq!(winner[1], FheOperation::Select as u8);
        assert_eq!(le_u16(winner[3], winner[4]), 9);
        assert_eq!(le_u16(winner[5], winner[6]), 7);
        assert_eq!(le_u16(winner[7], winner[8]), 5);

        let winning_bid = node_at(&graph, 11);
        assert_eq!(winning_bid[1], FheOperation::Select as u8);
        assert_eq!(le_u16(winning_bid[3], winning_bid[4]), 9);
        assert_eq!(le_u16(winning_bid[5], winning_bid[6]), 8);
        assert_eq!(le_u16(winning_bid[7], winning_bid[8]), 2);

        let winner_output = node_at(&graph, 12);
        assert_eq!(winner_output[0], GraphNodeKind::Output as u8);
        assert_eq!(le_u16(winner_output[3], winner_output[4]), 10);

        let price_output = node_at(&graph, 13);
        assert_eq!(price_output[0], GraphNodeKind::Output as u8);
        assert_eq!(le_u16(price_output[3], price_output[4]), 11);
    }

    #[test]
    fn execute_graph_instruction_data_uses_repo_wire_format() {
        let graph = build_resolve_auction_graph();
        let ix = build_execute_graph_instruction_data(&graph, RESOLVE_AUCTION_NUM_INPUTS);

        assert_eq!(ix[0], EXECUTE_GRAPH_DISCRIMINATOR);
        assert_eq!(le_u16(ix[1], ix[2]) as usize, graph.len());
        assert_eq!(&ix[3..3 + graph.len()], graph.as_slice());
        assert_eq!(ix.last().copied(), Some(RESOLVE_AUCTION_NUM_INPUTS));
        assert_eq!(ix.len(), 1 + 2 + graph.len() + 1);
    }
}
