import {
  addQueryRowAction,
  addResultsToCache,
  cancelQueries,
  cancelQueriesAction,
  clearCache,
  importQueries,
  loadLogsVolumeData,
  queryReducer,
  runQueries,
  scanStartAction,
  scanStopAction,
} from './query';
import { ExploreId, ExploreItemState, StoreState, ThunkDispatch } from 'app/types';
import { interval, Observable, of } from 'rxjs';
import {
  ArrayVector,
  DataFrame,
  DataQuery,
  DataQueryResponse,
  DataSourceApi,
  DataSourceJsonData,
  DefaultTimeZone,
  LoadingState,
  MutableDataFrame,
  PanelData,
  RawTimeRange,
  toUtc,
} from '@grafana/data';
import { thunkTester } from 'test/core/thunk/thunkTester';
import { makeExplorePaneState } from './utils';
import { reducerTester } from '../../../../test/core/redux/reducerTester';
import { configureStore } from '../../../store/configureStore';
import { setTimeSrv } from '../../dashboard/services/TimeSrv';
import Mock = jest.Mock;
import { config } from '@grafana/runtime';

jest.mock('@grafana/runtime', () => ({
  ...((jest.requireActual('@grafana/runtime') as unknown) as object),
  config: {
    ...((jest.requireActual('@grafana/runtime') as unknown) as any).config,
    featureToggles: {
      fullRangeLogsVolume: true,
      autoLoadFullRangeLogsVolume: false,
    },
  },
}));

const t = toUtc();
const testRange = {
  from: t,
  to: t,
  raw: {
    from: t,
    to: t,
  },
};
const defaultInitialState = {
  user: {
    orgId: '1',
    timeZone: DefaultTimeZone,
  },
  explore: {
    [ExploreId.left]: {
      datasourceInstance: {
        query: jest.fn(),
        getRef: jest.fn(),
        meta: {
          id: 'something',
        },
      },
      initialized: true,
      containerWidth: 1920,
      eventBridge: { emit: () => {} } as any,
      queries: [{ expr: 'test' }] as any[],
      range: testRange,
      refreshInterval: {
        label: 'Off',
        value: 0,
      },
      cache: [],
    },
  },
};

function setupQueryResponse(state: StoreState) {
  (state.explore[ExploreId.left].datasourceInstance?.query as Mock).mockReturnValueOnce(
    of({
      error: { message: 'test error' },
      data: [
        new MutableDataFrame({
          fields: [{ name: 'test', values: new ArrayVector() }],
          meta: {
            preferredVisualisationType: 'graph',
          },
        }),
      ],
    } as DataQueryResponse)
  );
}

describe('runQueries', () => {
  it('should pass dataFrames to state even if there is error in response', async () => {
    setTimeSrv({
      init() {},
    } as any);
    const { dispatch, getState }: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
      ...(defaultInitialState as any),
    });
    setupQueryResponse(getState());
    await dispatch(runQueries(ExploreId.left));
    expect(getState().explore[ExploreId.left].showMetrics).toBeTruthy();
    expect(getState().explore[ExploreId.left].graphResult).toBeDefined();
  });
});

describe('running queries', () => {
  it('should cancel running query when cancelQueries is dispatched', async () => {
    const unsubscribable = interval(1000);
    unsubscribable.subscribe();
    const exploreId = ExploreId.left;
    const initialState = {
      explore: {
        [exploreId]: {
          datasourceInstance: { name: 'testDs' },
          initialized: true,
          loading: true,
          querySubscription: unsubscribable,
          queries: ['A'],
          range: testRange,
        },
      },

      user: {
        orgId: 'A',
      },
    };

    const dispatchedActions = await thunkTester(initialState)
      .givenThunk(cancelQueries)
      .whenThunkIsDispatched(exploreId);

    expect(dispatchedActions).toEqual([scanStopAction({ exploreId }), cancelQueriesAction({ exploreId })]);
  });
});

describe('importing queries', () => {
  describe('when importing queries between the same type of data source', () => {
    it('remove datasource property from all of the queries', async () => {
      const { dispatch, getState }: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
        ...(defaultInitialState as any),
        explore: {
          [ExploreId.left]: {
            ...defaultInitialState.explore[ExploreId.left],
            datasourceInstance: { name: 'testDs', type: 'postgres' },
          },
        },
      });

      await dispatch(
        importQueries(
          ExploreId.left,
          [
            { datasource: { type: 'postgresql' }, refId: 'refId_A' },
            { datasource: { type: 'postgresql' }, refId: 'refId_B' },
          ],
          { name: 'Postgres1', type: 'postgres' } as DataSourceApi<DataQuery, DataSourceJsonData, {}>,
          { name: 'Postgres2', type: 'postgres' } as DataSourceApi<DataQuery, DataSourceJsonData, {}>
        )
      );

      expect(getState().explore[ExploreId.left].queries[0]).toHaveProperty('refId', 'refId_A');
      expect(getState().explore[ExploreId.left].queries[1]).toHaveProperty('refId', 'refId_B');
      expect(getState().explore[ExploreId.left].queries[0]).not.toHaveProperty('datasource');
      expect(getState().explore[ExploreId.left].queries[1]).not.toHaveProperty('datasource');
    });
  });
});

describe('reducer', () => {
  describe('scanning', () => {
    it('should start scanning', () => {
      const initialState: ExploreItemState = {
        ...makeExplorePaneState(),
        scanning: false,
      };

      reducerTester<ExploreItemState>()
        .givenReducer(queryReducer, initialState)
        .whenActionIsDispatched(scanStartAction({ exploreId: ExploreId.left }))
        .thenStateShouldEqual({
          ...initialState,
          scanning: true,
        });
    });
    it('should stop scanning', () => {
      const initialState = {
        ...makeExplorePaneState(),
        scanning: true,
        scanRange: {} as RawTimeRange,
      };

      reducerTester<ExploreItemState>()
        .givenReducer(queryReducer, initialState)
        .whenActionIsDispatched(scanStopAction({ exploreId: ExploreId.left }))
        .thenStateShouldEqual({
          ...initialState,
          scanning: false,
          scanRange: undefined,
        });
    });
  });

  describe('query rows', () => {
    it('adds a new query row', () => {
      reducerTester<ExploreItemState>()
        .givenReducer(queryReducer, ({
          queries: [],
        } as unknown) as ExploreItemState)
        .whenActionIsDispatched(
          addQueryRowAction({
            exploreId: ExploreId.left,
            query: { refId: 'A', key: 'mockKey' },
            index: 0,
          })
        )
        .thenStateShouldEqual(({
          queries: [{ refId: 'A', key: 'mockKey' }],
          queryKeys: ['mockKey-0'],
        } as unknown) as ExploreItemState);
    });
  });

  describe('caching', () => {
    it('should add response to cache', async () => {
      const { dispatch, getState }: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
        ...(defaultInitialState as any),
        explore: {
          [ExploreId.left]: {
            ...defaultInitialState.explore[ExploreId.left],
            queryResponse: {
              series: [{ name: 'test name' }] as DataFrame[],
              state: LoadingState.Done,
            } as PanelData,
            absoluteRange: { from: 1621348027000, to: 1621348050000 },
          },
        },
      });

      await dispatch(addResultsToCache(ExploreId.left));

      expect(getState().explore[ExploreId.left].cache).toEqual([
        { key: 'from=1621348027000&to=1621348050000', value: { series: [{ name: 'test name' }], state: 'Done' } },
      ]);
    });

    it('should not add response to cache if response is still loading', async () => {
      const { dispatch, getState }: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
        ...(defaultInitialState as any),
        explore: {
          [ExploreId.left]: {
            ...defaultInitialState.explore[ExploreId.left],
            queryResponse: { series: [{ name: 'test name' }] as DataFrame[], state: LoadingState.Loading } as PanelData,
            absoluteRange: { from: 1621348027000, to: 1621348050000 },
          },
        },
      });

      await dispatch(addResultsToCache(ExploreId.left));

      expect(getState().explore[ExploreId.left].cache).toEqual([]);
    });

    it('should not add duplicate response to cache', async () => {
      const { dispatch, getState }: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
        ...(defaultInitialState as any),
        explore: {
          [ExploreId.left]: {
            ...defaultInitialState.explore[ExploreId.left],
            queryResponse: {
              series: [{ name: 'test name' }] as DataFrame[],
              state: LoadingState.Done,
            } as PanelData,
            absoluteRange: { from: 1621348027000, to: 1621348050000 },
            cache: [
              {
                key: 'from=1621348027000&to=1621348050000',
                value: { series: [{ name: 'old test name' }], state: LoadingState.Done },
              },
            ],
          },
        },
      });

      await dispatch(addResultsToCache(ExploreId.left));

      expect(getState().explore[ExploreId.left].cache).toHaveLength(1);
      expect(getState().explore[ExploreId.left].cache).toEqual([
        { key: 'from=1621348027000&to=1621348050000', value: { series: [{ name: 'old test name' }], state: 'Done' } },
      ]);
    });

    it('should clear cache', async () => {
      const { dispatch, getState }: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
        ...(defaultInitialState as any),
        explore: {
          [ExploreId.left]: {
            ...defaultInitialState.explore[ExploreId.left],
            cache: [
              {
                key: 'from=1621348027000&to=1621348050000',
                value: { series: [{ name: 'old test name' }], state: 'Done' },
              },
            ],
          },
        },
      });

      await dispatch(clearCache(ExploreId.left));

      expect(getState().explore[ExploreId.left].cache).toEqual([]);
    });
  });

  describe('logs volume', () => {
    let dispatch: ThunkDispatch,
      getState: () => StoreState,
      unsubscribes: Function[],
      mockLogsVolumeDataProvider: () => Observable<DataQueryResponse>;

    beforeEach(() => {
      mockLogsVolumeDataProvider = () => {
        return of(
          { state: LoadingState.Loading, error: undefined, data: [] },
          { state: LoadingState.Done, error: undefined, data: [{}] }
        );
      };

      const store: { dispatch: ThunkDispatch; getState: () => StoreState } = configureStore({
        ...(defaultInitialState as any),
        explore: {
          [ExploreId.left]: {
            ...defaultInitialState.explore[ExploreId.left],
            datasourceInstance: {
              query: jest.fn(),
              getRef: jest.fn(),
              meta: {
                id: 'something',
              },
              getLogsVolumeDataProvider: () => {
                return mockLogsVolumeDataProvider();
              },
            },
          },
        },
      });

      dispatch = store.dispatch;
      getState = store.getState;

      setupQueryResponse(getState());
      unsubscribes = [];

      mockLogsVolumeDataProvider = () => {
        return ({
          subscribe: () => {
            const unsubscribe = jest.fn();
            unsubscribes.push(unsubscribe);
            return {
              unsubscribe,
            };
          },
        } as unknown) as Observable<DataQueryResponse>;
      };
    });

    it('should cancel any unfinished logs volume queries', async () => {
      await dispatch(runQueries(ExploreId.left));
      // no subscriptions created yet
      expect(unsubscribes).toHaveLength(0);

      await dispatch(loadLogsVolumeData(ExploreId.left));
      // loading in progress - one subscription created, not cleaned up yet
      expect(unsubscribes).toHaveLength(1);
      expect(unsubscribes[0]).not.toBeCalled();

      setupQueryResponse(getState());
      await dispatch(runQueries(ExploreId.left));
      // new query was run - first subscription is cleaned up, no new subscriptions yet
      expect(unsubscribes).toHaveLength(1);
      expect(unsubscribes[0]).toBeCalled();

      await dispatch(loadLogsVolumeData(ExploreId.left));
      // new subscription is created, only the old was was cleaned up
      expect(unsubscribes).toHaveLength(2);
      expect(unsubscribes[0]).toBeCalled();
      expect(unsubscribes[1]).not.toBeCalled();
    });

    it('should load logs volume after running the query', async () => {
      config.featureToggles.autoLoadFullRangeLogsVolume = true;
      await dispatch(runQueries(ExploreId.left));
      expect(unsubscribes).toHaveLength(1);
    });
  });
});
