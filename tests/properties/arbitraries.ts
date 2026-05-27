// Placeholder for fast-check arbitraries shared across property-based tests.
//
// Concrete arbitraries (e.g. SketchRecordArb, ContactRequestArb,
// CameraSnapshotArb) are introduced by later tasks alongside the property
// tests that consume them. Keeping this module as an empty export preserves
// import paths used by upcoming PBT tasks without leaking unfinished
// generators into the test runtime.
export {};
