// 정차 지점마다 객체와 경로 문구를 만들지 않고 숫자 배열에 간선을 저장한다.
export class Edges {
  heads: Int32Array
  from: Int32Array
  to: Int32Array
  next: Int32Array
  seconds: Float64Array
  kind: Uint8Array
  count = 0

  constructor(nodes: number, capacity: number) {
    this.heads = new Int32Array(nodes).fill(-1)
    this.from = new Int32Array(capacity)
    this.to = new Int32Array(capacity)
    this.next = new Int32Array(capacity)
    this.seconds = new Float64Array(capacity)
    this.kind = new Uint8Array(capacity)
  }

  add(from: number, to: number, seconds: number, kind: number) {
    if (this.count === this.from.length) {
      const capacity = Math.max(16, this.count * 2)
      const grow = <T extends Int32Array | Float64Array | Uint8Array>(array: T): T => {
        const Constructor = array.constructor as { new (length: number): T }
        const result = new Constructor(capacity)
        result.set(array)
        return result
      }
      this.from = grow(this.from)
      this.to = grow(this.to)
      this.next = grow(this.next)
      this.seconds = grow(this.seconds)
      this.kind = grow(this.kind)
    }
    const index = this.count++
    this.from[index] = from
    this.to[index] = to
    this.seconds[index] = seconds
    this.kind[index] = kind
    this.next[index] = this.heads[to]
    this.heads[to] = index
  }
}
