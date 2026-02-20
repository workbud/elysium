import { Repository, Service, ServiceScope } from '@elysiumjs/core';

import { UserModel } from '#hero/models/user.model';

@Service.register({ name: 'UserRepository', scope: ServiceScope.SINGLETON })
export class UserRepository extends Repository(UserModel) {}
