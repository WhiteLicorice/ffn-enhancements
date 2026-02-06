// enums/FicHubStatus.ts

export enum FicHubStatus {
    FRESH = 'FRESH', // the fichub cache matches what's on FFN
    STALE = 'STALE', // this means that the fichub cache does not reflect what is on FFN
    ERROR = 'ERROR', // if comparison fails or if query fails
}